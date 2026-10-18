import { isActiveExpedition, expeditionArrival, canCancelExpedition, neutralClaimMinimum } from './campaign-state';
import type { CampaignState, ExpeditionOrder } from './campaign-state';
import type { CampaignEncounterSetup } from './campaign-setup';
import { availablePoints } from './campaign-points';
import { developmentMaximum } from './campaign-development';
import { campaignWinner } from './campaign-scenario';
import { campaignLayout } from './campaign-layout';
import { campaignOrdersView, emptyCampaignOrdersPreference, reconcileCampaignOrdersPreference, showAllCampaignOrders } from './campaign-orders';
import { createMapInput } from './map-input';
import { createCampaignSetupView } from './campaign-setup-view';
import type { CampaignTransitionReport } from './campaign-report';
import { clearCampaignSelection, emptyCampaignSelection, focusCampaignSystem, reconcileCampaignSelection, selectCampaignSystem } from './campaign-selection';
import type { CampaignSelection } from './campaign-selection';

const node = function <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (text !== undefined) element.textContent = text;
	if (className) element.className = className;
	return element;
};
const amount = function (value: number): string { return value.toLocaleString(undefined, { maximumFractionDigits: 1 }); };
const wholeAmount = function (value: number): string { return value.toLocaleString(undefined, { maximumFractionDigits: 0 }); };
const campaignPaceOptions = [
	{ pace: 0.5, label: '0.5× · inspect' },
	{ pace: 1, label: '1× · normal' },
	{ pace: 2, label: '2× · fast' },
] as const;
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
	pause: () => Promise<void>;
	pace: (pace: 0.5 | 1 | 2) => Promise<void>;
	setup: (setup: CampaignEncounterSetup) => Promise<void>;
	launch: (setup: CampaignEncounterSetup) => Promise<void>;
	exit: () => Promise<void>;
	save?: () => Promise<void>;
}): {
	root: HTMLElement;
	render: (state: CampaignState, setup: CampaignEncounterSetup | undefined) => void;
	showSystem: (systemId: string) => void;
	prepareEncounter: () => void;
	notify: (message: string) => void;
	showReport: (report: CampaignTransitionReport, open?: boolean) => void;
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
	let selection: CampaignSelection = emptyCampaignSelection();
	let context: 'system' | 'orders' | 'menu' | 'report' | 'none' = 'system';
	const systemContext = function (): 'system' | 'none' { return selection.selectedSystemId === undefined ? 'none' : 'system'; };
	let campaignLabOpen = false;
	let report: CampaignTransitionReport | undefined;
	let ordersPreference = emptyCampaignOrdersPreference();
	let pending = false;
	let disposed = false;
	const drafts = new Map<string, Map<string, number>>();
	let renderedStructure = '';
	let liveUpdates: (() => void)[] = [];
	// Time and economic updates patch existing nodes, preserving focus, range drags, and map gestures.
	const structure = function (): string {
		return JSON.stringify([state?.phase, state?.paused, state?.pace, selection.selectedSystemId, selection.sourceSystemId, context,
			state?.planets.map(function (planet) { return [planet.id, planet.factionId]; }),
			context === 'orders' ? state?.expeditions.map(function (expedition) { return [expedition.id, expedition.status]; }) : null]);
	};
	const live = function (update: () => void): void { liveUpdates.push(update); update(); };
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
			if (planet.factionId !== 'blue') { draft.delete(planet.id); continue; }
			const maximum = Math.floor(availablePoints(developmentMaximum(planet), planet.depletion));
			draft.set(planet.id, Math.min(maximum, draft.get(planet.id) ?? Math.min(10, maximum)));
		}
		return draft;
	};
	const run = async function (action: () => Promise<void>, success?: () => void): Promise<void> {
		if (pending || disposed) return;
		const restorePaceFocus = document.activeElement === panel.querySelector<HTMLSelectElement>('.campaign-lab select');
		pending = true; root.inert = true; notify('');
		try {
			if (state?.encounter) await setupView.flush();
			await action();
			if (!disposed) { success?.(); if (!state?.encounter || preparedEncounter !== state.encounter.id) renderGalaxy(); }
		} catch (error) { if (!disposed) notify(error instanceof Error ? error.message : 'Campaign action failed.'); }
		finally {
			pending = false; root.inert = false;
			if (restorePaceFocus) panel.querySelector<HTMLSelectElement>('.campaign-lab select')?.focus();
		}
	};
	const selectSystem = function (id: string): void {
		if (!state?.systems.some(function (system) { return system.id === id; })) return;
		selection = selectCampaignSystem(selection, state, id);
		context = systemContext(); renderGalaxy();
	};
	const focusSystem = function (id: string): void {
		if (!state?.systems.some(function (system) { return system.id === id; })) return;
		selection = focusCampaignSystem(selection, state, id);
		context = 'system'; renderGalaxy();
	};
	const sendTo = function (id: string): void {
		if (!state || pending || state.phase !== 'galaxy' || campaignWinner(state)) return;
		const source = state.systems.find(function (system) { return system.id === selection.sourceSystemId; });
		const destination = state.systems.find(function (system) { return system.id === id; });
		if (!destination) return;
		if (!source || !localPlanets(source.id).some(function (planet) { return planet.factionId === 'blue'; })) {
			notify('Select a system you own as the funding source before sending. No points spent.'); return;
		}
		if (source.id === id) { notify('Choose a different destination from your funding system. No points spent.'); return; }
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
	const closePanel = function (): void { context = 'none'; renderGalaxy(); };
	const clearSelection = function (): void { selection = clearCampaignSelection(); context = 'none'; renderGalaxy(); };
	const heading = function (title: string, close: () => void = closePanel, closeLabel = 'Close panel'): void {
		const row = node('div', undefined, 'campaign-context-title');
		const control = button('×', close, 'campaign-close'); control.setAttribute('aria-label', closeLabel);
		row.append(node('h2', title), control); panel.append(row);
	};
	const renderSystem = function (): void {
		if (!state) return;
		const system = state.systems.find(function (item) { return item.id === selection.selectedSystemId; }); if (!system) return;
		const local = localPlanets(system.id);
		const owned = local.filter(function (planet) { return planet.factionId === 'blue'; });
		const canOrder = state.phase === 'galaxy' && !campaignWinner(state);
		const unclaimed = local.every(function (planet) { return planet.factionId === null; });
		heading(system.name, clearSelection, 'Clear selection');
		const balances = node('p', undefined, 'campaign-muted'); panel.append(balances);
		live(function () { balances.textContent = `${local.length} planets · ${amount(localPlanets(system.id).reduce(function (sum, planet) { return sum + availablePoints(developmentMaximum(planet), planet.depletion); }, 0))} points available`; });
		if (owned.length) {
			const draft = draftFor(system.id);
			const presets = node('div', undefined, 'campaign-presets');
			for (const percent of [25, 50, 100]) {
				const preset = button(`${percent}%`, function () {
				for (const planet of localPlanets(system.id).filter(function (item) { return item.factionId === 'blue'; })) draft.set(planet.id, Math.floor(availablePoints(developmentMaximum(planet), planet.depletion) * percent / 100));
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
				const ownAvailable = localPlanets(system.id).filter(function (planet) { return planet.factionId === 'blue'; }).reduce(function (sum, planet) { return sum + availablePoints(developmentMaximum(planet), planet.depletion); }, 0);
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
					const current = localPlanets(system.id).find(function (item) { return item.id === planet.id; });
					if (!current) return;
					const available = availablePoints(developmentMaximum(current), current.depletion);
					const maximum = Math.floor(available); field.max = String(maximum);
					draft.set(planet.id, Math.max(0, Math.min(maximum, value))); field.value = String(draft.get(planet.id) ?? 0);
					output.textContent = `${field.value} / ${amount(available)}`;
					minus.disabled = !canOrder || Number(field.value) <= 0; plus.disabled = !canOrder || Number(field.value) >= maximum; updateSummary();
				};
				field.addEventListener('input', function () { change(field.valueAsNumber); });
				const controls = node('div', undefined, 'campaign-allocation-controls'); controls.append(minus, field, plus); row.append(rowTitle, controls); details.append(row); live(function () { change(draft.get(planet.id) ?? 0); });
			}
			panel.append(details, summary);
		}
		for (const planet of local.filter(function (item) { return item.factionId !== 'blue'; })) {
			const row = node('div', undefined, 'campaign-planet-row'); const balance = node('span');
			row.append(node('span', `${planet.name} · ${factionLabel(planet.factionId)}`), balance); panel.append(row);
			live(function () {
				const current = localPlanets(system.id).find(function (item) { return item.id === planet.id; });
				if (current) balance.textContent = `${amount(availablePoints(developmentMaximum(current), current.depletion))} / ${amount(developmentMaximum(current))}`;
			});
		}
		const development = node('details', undefined, 'campaign-development'); development.append(node('summary', 'Development & recovery'),
			node('p', `Each galaxy second: +${amount(state.rules.development.growthFraction * 100)}% baseline capacity, capped at +${amount(state.rules.development.capFraction * 100)}%; ${amount(state.rules.recovery.fractionOfMaximum * 100)}% recovery. Captures remove ${amount(state.rules.development.captureLossFraction * 100)}% of development. Depletion persists.`)); panel.append(development);
		if (unclaimed) panel.append(node('p', `Minimum ${amount(neutralClaimMinimum(state, system.id))} points. First qualifying arrival claims all ${local.length} planets without battle; committed points remain spent.`, 'campaign-rule'));
		else if (!owned.length) panel.append(node('p', 'Hostile arrivals start separate real-time encounters. The galaxy waits until each battle resolves.', 'campaign-rule'));
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
		const ordersView = campaignOrdersView(state, selection.selectedSystemId, ordersPreference.showAll);
		heading(`Orders · ${ordersView.scope}`);
		panel.append(node('p', `${ordersView.expeditions.length} active expeditions${state.phase === 'encounter' ? ' · galaxy frozen' : ''}`, 'campaign-muted'));
		if (ordersView.scoped) panel.append(button('Show all', function () {
			ordersPreference = showAllCampaignOrders(ordersPreference);
			renderGalaxy();
			panel.querySelector<HTMLButtonElement>('.campaign-close')?.focus();
		}, 'campaign-wide'));
		if (!ordersView.expeditions.length) panel.append(node('p', ordersView.scoped ? 'No active expeditions for this system.' : 'No active expeditions.', 'campaign-rule'));
		for (const expedition of ordersView.expeditions) {
			const source = state.systems.find(function (item) { return item.id === expedition.sourceSystemId; });
			const destination = state.systems.find(function (item) { return item.id === expedition.destinationSystemId; });
			const row = node('section', undefined, 'campaign-order');
			const timing = node('p', undefined, 'campaign-muted');
			live(function () {
				if (state) timing.textContent = `${factionLabel(expedition.factionId)} · ${amount(expedition.points)} points · ${expedition.status === 'encounter' ? 'Arrived · resolving now' : `${expedition.status === 'returning' ? 'Returning · ' : ''}ETA ${amount(Math.max(0, expeditionArrival(expedition) - state.time))}s`}`;
			});
			row.append(node('strong', `${source?.name ?? expedition.sourceSystemId} ${expedition.status === 'returning' ? '←' : '→'} ${destination?.name ?? expedition.destinationSystemId}`), timing,
				button(expedition.status === 'returning' ? 'Show source' : 'Show destination', function () { focusSystem(expedition.status === 'returning' ? expedition.sourceSystemId : expedition.destinationSystemId); }, 'campaign-wide'));
			if (expedition.factionId === 'blue') {
				const cancel = button(expedition.status === 'returning' ? 'Returning' : expedition.departureTime === state.time ? 'Cancel launch' : '↶ Recall', function () {
					void run(function () { return options.cancelOrder(expedition.id); });
				}, 'campaign-wide');
				live(function () {
					if (!state) return;
					cancel.textContent = expedition.status === 'returning' ? 'Returning' : expedition.departureTime === state.time ? 'Cancel launch' : '↶ Recall';
					cancel.disabled = !canCancelExpedition(state, expedition, 'blue') || Boolean(campaignWinner(state));
					cancel.setAttribute('aria-label', `${cancel.textContent}: ${source?.name ?? expedition.sourceSystemId} → ${destination?.name ?? expedition.destinationSystemId}`);
				});
				row.append(cancel);
			}
			panel.append(row);
		}
		panel.append(node('p', 'Cancel a launch before galaxy time advances to refund its source points. Recall traveling expeditions to return points to their contributing planets after the elapsed outbound travel time. Only planets you still own are replenished; surplus is lost.', 'campaign-rule'));
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
		heading(report.outcome ? 'Battle resolved' : report.timeAdvanced ? `Galaxy ${amount(report.toTime)}s` : 'Galaxy resolution');
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
		if (state.encounter) panel.append(node('p', 'Later arrivals wait. Galaxy time and recovery remain frozen during combat.', 'campaign-rule'), button('Prepare encounter', prepare, 'campaign-wide campaign-primary'));
		else panel.append(button('Return to system', function () { context = systemContext(); renderGalaxy(); }, 'campaign-wide'));
	};
	const renderGalaxy = function (): void {
		if (!state || disposed) return;
		ordersPreference = reconcileCampaignOrdersPreference(ordersPreference, selection.selectedSystemId);
		renderedStructure = structure(); liveUpdates = [];
		header.replaceChildren(); world.replaceChildren(); panel.replaceChildren();
		const brand = node('span', 'Galaxy Conquest', 'campaign-brand');
		const score = node('div', undefined, 'campaign-score');
		const clock = node('span', undefined, 'campaign-clock');
		live(function () { if (state) clock.textContent = `Galaxy ${amount(state.time)}s${state.encounter ? ' · Frozen' : state.paused ? ' · Paused' : ''}`; });
		score.append(node('span', `● ${state.planets.filter(function (planet) { return planet.factionId === 'blue'; }).length} YOU`, 'campaign-blue'),
			clock,
			node('span', `● ${state.planets.filter(function (planet) { return planet.factionId === 'red'; }).length} RIVAL`, 'campaign-red'));
		const actions = node('div', undefined, 'campaign-actions');
		if (options.save) actions.append(button('Save', function () { void run(async function () { await options.save?.(); }); }, 'campaign-save'));
		const orderScope = campaignOrdersView(state, selection.selectedSystemId, ordersPreference.showAll);
		const orders = button(`Orders · ${orderScope.expeditions.length}`, function () { context = context === 'orders' ? systemContext() : 'orders'; renderGalaxy(); });
		orders.setAttribute('aria-expanded', String(context === 'orders'));
		live(function () {
			if (!state) return;
			const currentOrders = campaignOrdersView(state, selection.selectedSystemId, ordersPreference.showAll);
			orders.textContent = `Orders · ${currentOrders.expeditions.length}`;
			orders.setAttribute('aria-label', `Orders · ${currentOrders.scope} · ${currentOrders.expeditions.length}`);
		});
		const end = button(state.encounter ? 'Prepare encounter' : state.paused ? 'Resume' : 'Pause', function () { if (state?.encounter) prepare(); else void run(options.pause); }, 'campaign-primary');
		end.disabled = !state.encounter && Boolean(campaignWinner(state));
		if (!state.encounter) { end.setAttribute('aria-pressed', String(state.paused)); end.setAttribute('aria-label', state.paused ? 'Resume galaxy time' : 'Pause galaxy time'); }
		const menu = button('☰', function () { context = context === 'menu' ? systemContext() : 'menu'; renderGalaxy(); }, 'campaign-menu'); menu.setAttribute('aria-label', 'Campaign menu'); menu.setAttribute('aria-expanded', String(context === 'menu'));
		actions.append(orders, end, menu); header.append(brand, score, actions);
		const bounds = galaxyBounds();
		world.style.width = `${bounds.width}px`;
		world.style.height = `${bounds.height}px`;
		let routeStructure = '';
		let routes: SVGSVGElement | undefined;
		let routeUpdates: (() => void)[] = [];
		live(function () {
			if (!state) return;
			const active = state.expeditions.filter(isActiveExpedition);
			const nextStructure = JSON.stringify(active.map(function (expedition) { return [expedition.id, expedition.status]; }));
			if (nextStructure !== routeStructure || !routes) {
				routeStructure = nextStructure; routeUpdates = []; routes?.remove();
				routes = svg('svg', { viewBox: `0 0 ${bounds.width} ${bounds.height}`, 'aria-hidden': 'true', class: 'campaign-routes' });
				for (const expedition of state.expeditions.filter(isActiveExpedition)) {
					const source = state.systems.find(function (item) { return item.id === expedition.sourceSystemId; });
					const destination = state.systems.find(function (item) { return item.id === expedition.destinationSystemId; });
					if (!source || !destination) continue;
					const a = position(source); const b = position(destination);
					const line = svg('line', { x1: String(a.x), y1: String(a.y), x2: String(b.x), y2: String(b.y), stroke: expedition.factionId === 'blue' ? '#60d9ff' : '#ff867e' });
					const moving = svg('circle', { r: '4', fill: expedition.factionId === 'blue' ? '#60d9ff' : '#ff867e' });
					routeUpdates.push(function () {
						if (!state) return;
						const distanceTime = expedition.recalledTime === undefined ? state.time - expedition.departureTime : 2 * expedition.recalledTime - state.time - expedition.departureTime;
						const fraction = Math.max(0, Math.min(1, distanceTime / (expedition.arrivalTime - expedition.departureTime)));
						moving.setAttribute('cx', String(a.x + (b.x - a.x) * fraction)); moving.setAttribute('cy', String(a.y + (b.y - a.y) * fraction));
					});
					const label = svg('text', { x: String((a.x + b.x) / 2 + 12), y: String((a.y + b.y) / 2 - 12) }); label.textContent = `${expedition.status === 'returning' ? '↶ ' : ''}${amount(expedition.points)}`; routes.append(line, label, moving);
				}
				world.prepend(routes);
			}
			for (const update of routeUpdates) update();
		});
		for (const [index, system] of state.systems.entries()) {
			const planets = localPlanets(system.id); const owners = new Set(planets.map(function (planet) { return planet.factionId; }));
			const owner = owners.size === 1 ? planets[0]?.factionId : undefined;
			const points = planets.reduce(function (sum, planet) { return sum + availablePoints(developmentMaximum(planet), planet.depletion); }, 0);
			const marker = node('button', undefined, `campaign-system${selection.selectedSystemId === system.id && context === 'system' ? ' selected' : ''}`); marker.type = 'button'; marker.dataset.systemIndex = String(index);
			const location = position(system); marker.style.left = `${location.x}px`; marker.style.top = `${location.y}px`;
			marker.style.setProperty('--owner', owner === 'blue' ? '#60d9ff' : owner === 'red' ? '#ff867e' : owner === null ? '#8e9cae' : '#cbbcf1');
			const minimum = owner === null ? neutralClaimMinimum(state, system.id) : undefined;
			const source = state.systems.find(function (item) { return item.id === selection.sourceSystemId; });
			const travel = source ? Math.ceil(Math.max(state.rules.minimumTravelTime, Math.hypot(system.x - source.x, system.y - source.y) / state.rules.travelSpeed)) : undefined;
			marker.title = `${system.name} · ${minimum !== undefined ? `Claim minimum ${wholeAmount(minimum)} points` : owner === undefined ? 'Mixed ownership' : factionLabel(owner)}${travel !== undefined && source?.id !== system.id ? ` · ${travel}s travel` : ''}`;
			marker.setAttribute('aria-label', `${system.name}, ${owner === undefined ? 'mixed ownership' : factionLabel(owner)}, ${wholeAmount(points)} points${minimum !== undefined ? `, minimum claim ${wholeAmount(minimum)} points` : ''}`);
			const art = svg('svg', { viewBox: '0 0 100 80', class: 'campaign-system-art', 'aria-hidden': 'true' });
			for (const radius of [21, 34, 46]) art.append(svg('ellipse', { cx: '50', cy: '40', rx: String(radius), ry: String(radius * .55), transform: 'rotate(-25 50 40)', class: 'campaign-orbit' }));
			art.append(svg('circle', { cx: '50', cy: '40', r: '19', class: 'campaign-star-halo' }), svg('path', { d: 'M50 23V57M33 40H67M39 29L61 51M39 51L61 29', class: 'campaign-star-ray' }), svg('circle', { cx: '50', cy: '40', r: '6', class: 'campaign-star-core' }));
			for (const [planetIndex, planet] of planets.entries()) {
				const angle = planetIndex * 2.4; const radius = 20 + planetIndex * 10;
				art.append(svg('circle', { cx: String(50 + Math.cos(angle) * radius), cy: String(40 + Math.sin(angle) * radius * .6), r: '3.5', fill: planet.factionId === 'blue' ? '#60d9ff' : planet.factionId === 'red' ? '#ff867e' : '#8e9cae', class: 'campaign-world-dot' }));
			}
			const copy = node('span', undefined, 'campaign-system-copy'); copy.append(node('strong', system.name), node('span', `${wholeAmount(points)} points`, 'campaign-system-points'), node('small', minimum !== undefined ? `UNCLAIMED · min ${wholeAmount(minimum)} points` : `${owner === undefined ? 'MIXED' : factionLabel(owner)} · ${planets.length} planets`)); marker.append(art, copy); world.append(marker);
			live(function () {
				const points = localPlanets(system.id).reduce(function (sum, planet) { return sum + availablePoints(developmentMaximum(planet), planet.depletion); }, 0);
				const balance = copy.querySelector('.campaign-system-points'); if (balance) balance.textContent = `${wholeAmount(points)} points`;
				marker.setAttribute('aria-label', `${system.name}, ${owner === undefined ? 'mixed ownership' : factionLabel(owner)}, ${wholeAmount(points)} points${minimum !== undefined ? `, minimum claim ${wholeAmount(minimum)} points` : ''}`);
			});
		}
		panel.hidden = context === 'none';
		if (context === 'system') renderSystem();
		if (context === 'orders') renderOrders();
		if (context === 'report') renderReport();
		if (context === 'menu') {
			heading('Game menu'); panel.append(node('p', 'Campaign preview · saved locally in a separate campaign slot', 'campaign-muted'),
				button('Return to galaxy', function () { context = systemContext(); renderGalaxy(); }, 'campaign-wide'));
			const lab = node('details', undefined, 'campaign-lab');
			lab.append(node('summary', 'Prototype lab'));
			lab.open = campaignLabOpen;
			lab.addEventListener('toggle', function () { campaignLabOpen = lab.open; });
			const paceLabel = node('label', 'Simulation pace');
			const paceSelect = node('select');
			for (const option of campaignPaceOptions) {
				const item = node('option', option.label);
				item.value = String(option.pace);
				paceSelect.append(item);
			}
			paceSelect.value = String(state.pace);
			paceSelect.disabled = Boolean(state.encounter) || Boolean(campaignWinner(state));
			paceSelect.addEventListener('change', function () {
				const option = campaignPaceOptions.find(function (candidate) { return String(candidate.pace) === paceSelect.value; });
				if (option === undefined) return;
				void run(function () { return options.pace(option.pace); });
			});
			paceLabel.append(paceSelect);
			lab.append(paceLabel);
			panel.append(lab);
			if (options.save) panel.append(button('Save campaign', function () { void run(async function () { await options.save?.(); }); }, 'campaign-wide'));
			if (report) panel.append(button('Last resolution', function () { context = 'report'; renderGalaxy(); }, 'campaign-wide'));
			if (state.encounter) panel.append(button('Prepare encounter', prepare, 'campaign-wide campaign-primary'));
			panel.append(button('Save & menu', function () { void run(options.exit); }, 'campaign-wide'), node('p', 'Select a funding system. Adjust contributions, then hold or right-click a destination. Resume galaxy time to advance expeditions, recovery, and rival orders. Pause to plan without advancing time.', 'campaign-rule'));
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
		selection = reconcileCampaignSelection(selection, state);
		if (state.encounter && setup && preparedEncounter === state.encounter.id) { galaxy.hidden = true; setupView.root.hidden = false; setupView.render(state, setup); return; }
		galaxy.hidden = false; setupView.root.hidden = true;
		if (!state.encounter) preparedEncounter = undefined;
		if (renderedStructure === structure()) { for (const update of liveUpdates) update(); }
		else renderGalaxy();
	};
	return { root, render,
		prepareEncounter: prepare, notify,
		showSystem: function (systemId): void { focusSystem(systemId); },
		showReport: function (nextReport, open = true): void {
			report = nextReport;
			if (!open) return;
			preparedEncounter = undefined; input.cancel(); setupView.root.hidden = true; galaxy.hidden = false;
			if (nextReport.focusSystemId && state) selection = focusCampaignSystem(selection, state, nextReport.focusSystemId);
			context = 'report'; renderGalaxy();
		},
		reset: function (): void {
			setupView.reset();
			input.cancel(); drafts.clear(); state = undefined; selection = emptyCampaignSelection(); ordersPreference = emptyCampaignOrdersPreference(); report = undefined; encounterSetup = undefined; preparedEncounter = undefined;
			context = 'system'; campaignLabOpen = false; renderedStructure = ''; liveUpdates = []; fitPending = true; camera = { x: 0, y: 0, scale: 1 }; notify(''); setupView.root.hidden = true; galaxy.hidden = false;
		},
		dispose: function (): void { disposed = true; input.dispose(); resize.disconnect(); setupView.dispose(); root.remove(); },
	};
};
