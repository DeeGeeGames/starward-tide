import { createGamepadInput, type GamepadFrame } from './gamepad-input';
import { moveFocus, activateControl, visibleControls } from './ui-navigation';
import { GAME_MODES, destinationFor } from './objectives';
import { confirmAction } from './ui-dialog';
import { createPerformanceDiagnostics, type PerformanceDiagnostics, type DiagnosticsReport } from './performance-diagnostics';
import { createCrowdedBaseline } from './performance-scenario';
import { createThreeRenderer } from './three-renderer';
import { createMapInput } from './map-input';
import { createFleetTargets } from './fleet-targets';
import { createOrdersDrawer } from './orders-drawer';
import { revealPoint } from './camera';
import { fitIsometricCamera, projectMap, unprojectMap } from './isometric';
import type { ViewportArea } from './camera';
import { createPresentation } from './presentation';
import { visibleMapLabels, type LabelBounds, type MapLabel } from './map-labels';
import type { Camera, Point } from './camera';
import { CONFIG, COLORS, SIDES, isHostile, factionLabel } from './config';
import { DEFAULT_OPPONENT, opponentLabel } from './opponent';
import type { OpponentSettings } from './opponent';
import { LAB_MAP, mapSides } from './maps';
import type { StarMap } from './maps';
import { createFrontMenu } from './front-menu';
import type { DispatchFilter, Production, Scenario } from './config';
import { captureConquestSave } from './game-save';
import {
	createGame,
	matchEnded,
	dockedShips,
	availableShips,
	moveCarrier,
	bombardPlanet,
	cancelBombardment,
	launchCarrierShips,
	previewDispatch,
	dispatch,
	dispatchIntercept,
	isBlockaded,
	planets,
	setProduction,
	shipsAt,
	units,
} from './game';
import type { Game } from './game';
import { openProfileRepository } from './profile-storage';
import type { ProfileRepository, ProfileSummary } from './profile-storage';
import { formatElapsedTime } from './time-format';
import { createSoundPlayer } from './sound-player';
import { drainSounds } from './sound-events';

document.addEventListener('contextmenu', function (event) {
	event.preventDefault();
}, { capture: true });

const element = function <T extends HTMLElement>(
	id: string,
	constructor: { new (...args: never[]): T },
): T {
	const found = document.getElementById(id);
	if (!(found instanceof constructor)) throw new Error(`Missing ${id}`);
	return found;
};
const board = element('board', HTMLElement);
const app = element('app', HTMLDivElement);
const mapWorld = element('map-world', HTMLDivElement);
const planetPanel = element('planet-panel', HTMLElement);
const productionControls = element('production-controls', HTMLDivElement);
const dispatchControls = element('dispatch-controls', HTMLDivElement);
const dispatchFilterControls = element(
	'dispatch-filter-controls',
	HTMLDivElement,
);
const dispatchInfo = element('dispatch-info', HTMLSpanElement);
const commandActions = element('command-actions', HTMLDivElement);
const dispatchDetails = element('dispatch-details', HTMLDivElement);
const openDispatchButton = element('open-dispatch', HTMLButtonElement);
const openProductionButton = element('open-production', HTMLButtonElement);
const selectionOrdersButton = element('selection-orders', HTMLButtonElement);
const commandBackButton = element('command-back', HTMLButtonElement);
const sendUnitsButton = element('send-units', HTMLButtonElement);
const productionOverview = document.createElement('span');
productionOverview.id = 'production-overview';
commandActions.after(productionOverview);
const canvas = element('space', HTMLCanvasElement);
const planetLayer = element('planets', HTMLDivElement);
const fleetLayer = document.createElement('div');
fleetLayer.id = 'fleet-targets';
mapWorld.append(fleetLayer);
const fleetTargets = createFleetTargets(fleetLayer);
const pause = element('pause', HTMLButtonElement);
const scenarioSelect = element('scenario', HTMLSelectElement);
const aiInput = element('ai', HTMLInputElement);
const speedSelect = element('speed', HTMLSelectElement);
const instruction = element('instruction', HTMLSpanElement);
const selectionName = element('selection-name', HTMLHeadingElement);
const selectionInfo = element('selection-info', HTMLParagraphElement);
const orbitalInfo = element('orbital-info', HTMLParagraphElement);
const productionInfo = element('production-info', HTMLSpanElement);
const banner = element('banner', HTMLDivElement);
const events = element('events', HTMLDivElement);
const metrics = element('metrics', HTMLDivElement);
const blueCount = element('blue-count', HTMLElement);
const redCount = element('red-count', HTMLElement);
const clock = element('clock', HTMLDivElement);
const multiButton = element('multi', HTMLButtonElement);
const saveGameButton = element('save-game', HTMLButtonElement);
const saveStatus = element('save-status', HTMLSpanElement);
const menuSaveStatus = element('save-status-menu', HTMLParagraphElement);
const bannerMessage = document.createElement('span');
banner.replaceChildren(bannerMessage);
const productionButtons = [
	...document.querySelectorAll<HTMLButtonElement>('[data-production]'),
];
const amountButtons = [
	...document.querySelectorAll<HTMLButtonElement>('[data-amount]'),
];
const filterButtons = [
	...document.querySelectorAll<HTMLButtonElement>('[data-filter]'),
];
const sounds = createSoundPlayer();
const soundListeners = new AbortController();
const unlockSound = function (): void { sounds.unlock(); };
document.addEventListener('pointerdown', unlockSound, { capture: true, signal: soundListeners.signal });
document.addEventListener('keydown', unlockSound, { capture: true, signal: soundListeners.signal });
const soundButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-sound-toggle]')];
const syncSoundButtons = function (): void {
	for (const button of soundButtons) {
		button.textContent = sounds.isMuted() ? 'Sound: Off' : 'Sound: On';
		button.setAttribute('aria-pressed', String(!sounds.isMuted()));
		button.title = sounds.isMuted() ? 'Enable sound effects' : 'Mute sound effects';
	}
};
for (const button of soundButtons) button.addEventListener('click', function () {
	sounds.setMuted(!sounds.isMuted());
	syncSoundButtons();
	sounds.play('select');
}, { signal: soundListeners.signal });
document.addEventListener('click', function (event) {
	const button = event.target instanceof Element ? event.target.closest('button') : null;
	if (button && !button.disabled && !button.matches('.planet, [data-sound-toggle]')) sounds.play('select');
}, { signal: soundListeners.signal });
window.addEventListener('blur', function () { sounds.setActive(false); }, { signal: soundListeners.signal });
window.addEventListener('focus', function () { sounds.setActive(!document.hidden); }, { signal: soundListeners.signal });
document.addEventListener('visibilitychange', function () {
	sounds.setActive(!document.hidden && document.hasFocus());
}, { signal: soundListeners.signal });
syncSoundButtons();
interface PlanetView {
	button: HTMLButtonElement;
	count: HTMLSpanElement;
	name: HTMLSpanElement;
	orbit: HTMLSpanElement;
	mark: HTMLSpanElement;
	progress: HTMLElement;
	bombardment: HTMLSpanElement;
}
type GamePace = 0.5 | 1 | 2;
interface GameInstallation {
	game: Game;
	map: StarMap;
	scenario: Scenario;
	profileId: string;
	pace: GamePace;
	paused: boolean;
	hiddenPause: boolean;
	savedAt: number;
}
const views = new Map<number, PlanetView>();
let activeMap: StarMap = LAB_MAP;
let profileRepository: ProfileRepository | undefined;
let initialProfiles: ProfileSummary[] = [];
let activeProfileId: string | null = null;
let profileStorageMessage: string | null = null;
let hasActiveConquest = false;
let queuedAutosave: number | undefined;
try {
	profileRepository = await openProfileRepository();
	initialProfiles = await profileRepository.listProfiles();
	if (initialProfiles.length === 0)
		initialProfiles = [await profileRepository.createProfile('Player')];
	const storedSelection = await profileRepository.getSelectedProfileId();
	activeProfileId = initialProfiles.some(function (profile) {
		return profile.id === storedSelection;
	})
		? storedSelection
		: (initialProfiles[0]?.id ?? null);
	if (activeProfileId !== storedSelection)
		await profileRepository.setSelectedProfileId(activeProfileId);
} catch (error) {
	profileRepository?.close();
	profileRepository = undefined;
	profileStorageMessage = error instanceof Error
		? error.message
		: 'Browser storage could not open. Open the standalone game to use local profiles.';
}
let world: Game = await createGame();
const presentation = await createPresentation();
let diagnostics: PerformanceDiagnostics | undefined;
let diagnosticsEnabled = new URLSearchParams(location.search).get('diagnostics') === '1';
let selected: number[] = [];
let inspected: number | undefined;
let fraction = 0.5;
let filter: DispatchFilter = 'combined';
let multi = false;
let scenario: Scenario = 'skirmish';
let speed: GamePace = 1;
let busy = false;
let disposed = false;
let raf = 0;
let choosingDestination: false | 'dispatch' | 'bombard' = false;
type CommandView = 'overview' | 'production';
let commandView: CommandView = 'overview';
let sheetCollapsed = false;
let lastNoticeKey = '';
let hiddenPause = false;
const icons: Record<Production, string> = {
	troops: '▥',
	ships: '◆',
	guns: '✣',
};
const feedback = function (text: string): void {
	presentation.notify(text);
};
const saveErrorMessage = function (error: unknown): string {
	const message =
		error instanceof Error
			? error.message
			: 'Browser storage could not complete the request.';
	return window.top !== window.self
		? `${message} Open the standalone game to use local saves.`
		: message;
};
const updateSaveStatus = function (message: string): void {
	saveStatus.textContent = message.startsWith('Saved ') ? '✓ Saved' : message;
	saveStatus.title = message;
	saveStatus.dataset.state = message.startsWith('Save failed') ? 'error' : 'normal';
	menuSaveStatus.textContent = message;
};
const savedStatus = function (savedAt: number): string {
	return `Saved ${new Date(savedAt).toLocaleString()}`;
};
const sameMap = function (left: StarMap, right: StarMap): boolean {
	return (
		Boolean(left.carriers) === Boolean(right.carriers) &&
		(left.mode ?? 'conquest') === (right.mode ?? 'conquest') &&
		left.width === right.width &&
		left.height === right.height &&
		left.planets.length === right.planets.length &&
		left.planets.every(function (planet, index) {
			const match = right.planets[index];
			return (
				match !== undefined &&
				planet.every(function (value, field) {
					return value === match[field];
				})
			);
		})
	);
};
const saveCurrentProfile = async function (): Promise<void> {
	if (!hasActiveConquest) return;
	if (!profileRepository || activeProfileId === null)
		throw new Error('Select a local profile before saving this conquest.');
	const profileId = activeProfileId;
	const capture = function (): ReturnType<typeof captureConquestSave> { return captureConquestSave(
		world,
		activeMap,
		scenario,
		speed,
		profileId,
	); };
	const save = diagnostics ? diagnostics.measure('save.capture', capture) : capture();
	updateSaveStatus('Saving…');
	try {
		// Async saveProfile validates/clones synchronously before its first await.
		const repository = profileRepository;
		const write = function (): Promise<void> { return repository.saveProfile(save); };
		await (diagnostics ? diagnostics.measure('save.validateCloneSync', write) : write());
		if (activeProfileId === profileId) updateSaveStatus(savedStatus(save.savedAt));
	} catch (error) {
		const message = saveErrorMessage(error);
		updateSaveStatus(`Save failed · ${message}`);
		feedback(`Save failed: ${message}`);
		throw error;
	}
};
const queueAutosave = function (): void {
	if (busy || !hasActiveConquest || frontMenu.getCurrentScreen() !== 'playing') return;
	if (queuedAutosave !== undefined) window.clearTimeout(queuedAutosave);
	queuedAutosave = window.setTimeout(function () {
		queuedAutosave = undefined;
		if (busy || frontMenu.getCurrentScreen() !== 'playing') return;
		void saveCurrentProfile().catch(function () {});
	}, 800);
};
const saveBeforeLeavingGame = async function (): Promise<boolean> {
	if (busy) return false;
	busy = true;
	app.inert = true;
	if (queuedAutosave !== undefined) {
		window.clearTimeout(queuedAutosave);
		queuedAutosave = undefined;
	}
	const match = world.getResource('match');
	const wasPaused = match.paused;
	mapInput.cancel();
	match.paused = true;
	try {
		await saveCurrentProfile();
		return true;
	} catch {
		match.paused = wasPaused;
		refresh();
		return false;
	} finally {
		busy = false;
		app.inert = false;
	}
};
// Every transition out of command picking also cancels a pending touch hold.
const cancelMapCommand = function (): void {
	mapInput.cancel();
	choosingDestination = false;
};
const clearSelection = function (): void {
	cancelMapCommand();
	selected = [];
	inspected = undefined;
	multi = false;
	commandView = 'overview';
};
const selectPlanet = function (id: number, additive = false): void {
	if (
		busy ||
		frontMenu.getCurrentScreen() !== 'playing' ||
		matchEnded(world.getResource('match'))
	)
		return;
	const p = world.getComponent(id, 'planet');
	if (!p) return;
	cancelMapCommand();
	sounds.play('select');
	sheetCollapsed = false;
	commandView = 'overview';
	const selectable =
		p.owner === 'blue' || shipsAt(world, id, 'blue').length > 0;
	if (selected.includes(id) && (multi || additive)) {
		selected = selected.filter(function (value) {
			return value !== id;
		});
		inspected = undefined;
	} else if (multi || additive) {
		if (selectable) {
			selected = [...selected, id];
			inspected = undefined;
		} else feedback(multi ? 'Finish source selection before choosing a destination.' : 'Choose one of your worlds or orbital ships to add.');
	} else {
		selected = selectable ? [id] : [];
		inspected = p.owner === 'blue' ? undefined : id;
	}
	refresh();
	updateLayout();
};
const sendToPlanet = function (id: number): void {
	if (
		busy ||
		frontMenu.getCurrentScreen() !== 'playing' ||
		matchEnded(world.getResource('match'))
	)
		return;
	const p = world.getComponent(id, 'planet');
	if (!p) return;
	if (choosingDestination === 'bombard') {
		const source = selected.length === 1 ? selected[0] : undefined;
		if (source !== undefined && bombardPlanet(world, source, id)) {
			sounds.play('command');
			feedback(`Carrier approaching ${p.name} to bombard`);
			cancelMapCommand();
			queueAutosave();
		} else {
			sounds.play('error');
			feedback('Choose a hostile or defended neutral planet. Carriers cannot be bombarded.');
		}
		refresh();
		return;
	}
	if (multi) feedback('Finish source selection before sending units.');
	else if (selected.length === 0)
		feedback('Select a blue planet or orbital ring first.');
	else {
		const shipsOnly = selected.every(function (source) {
			return world.getComponent(source, 'planet')?.owner !== 'blue';
		});
		const sent = dispatch(
			world,
			selected,
			id,
			fraction,
			shipsOnly ? 'ships' : filter,
		);
		sounds.play(sent > 0 ? 'command' : 'error');
		feedback(
			sent > 0
				? `${sent} ${sent === 1 ? 'unit' : 'units'} launched → ${p.name}`
				: 'No units launched. Check stock, filter, or blockade.',
		);
		if (sent > 0) {
			cancelMapCommand();
			queueAutosave();
		}
	}
	refresh();
};
const sendToFleet = function (id: number): void {
	if (busy || frontMenu.getCurrentScreen() !== 'playing' || matchEnded(world.getResource('match'))) return;
	if (choosingDestination === 'bombard') feedback('Choose a planet to bombard.');
	else if (multi) feedback('Finish source selection before sending ships.');
	else if (selected.length === 0) feedback('Select a blue planet or orbital ring first.');
	else if (filter === 'troops' && selected.some(function (source) { return world.getComponent(source, 'planet')?.owner === 'blue'; }))
		feedback('Choose Combined or Ships to intercept. Transports cannot intercept.');
	else {
		const sent = dispatchIntercept(world, selected, id, fraction);
		sounds.play(sent > 0 ? 'command' : 'error');
		feedback(sent > 0 ? `${sent} ${sent === 1 ? 'ship' : 'ships'} launched to intercept · returns after pursuit` : 'No ships launched. Check ship stock or blockade; the group may have arrived.');
		if (sent > 0) {
			cancelMapCommand();
			queueAutosave();
		}
	}
	refresh();
};
const mountPlanets = function (): void {
	fleetTargets.reset();
	planetLayer.replaceChildren();
	for (const destination of world.getResource('objectives').destinations) {
		const marker = document.createElement('div');
		marker.className = 'race-destination';
		marker.dataset.owner = destination.owner;
		const point = projectMap(destination);
		marker.style.left = `${point.x}px`;
		marker.style.top = `${point.y}px`;
		marker.style.width = `${destination.radius * 2}px`;
		marker.style.height = `${destination.radius * 2 / Math.sqrt(3)}px`;
		marker.style.setProperty('--destination-color', destination.owner === 'neutral' ? '#f8d787' : COLORS[destination.owner]);
		marker.setAttribute('role', 'img');
		marker.setAttribute('aria-label', destination.label);
		const label = document.createElement('span');
		label.textContent = destination.label;
		marker.append(label);
		planetLayer.append(marker);
	}
	views.clear();
	for (const {
		id,
		components: { planet: p },
	} of planets(world)) {
		const button = document.createElement('button');
		button.className = p.carrier ? 'planet carrier' : 'planet';
		button.dataset.planet = p.name;
		const point = projectMap(p);
		button.style.left = `${point.x}px`;
		button.style.top = `${point.y}px`;
		button.innerHTML =
			'<span class="surface"></span><span class="count"></span><span class="name"></span><span class="orbit-count"></span><span class="production-mark"></span><span class="production-progress"><i></i></span><span class="bombardment-label" hidden></span>';
		const count = button.querySelector('.count');
		const name = button.querySelector('.name');
		const orbit = button.querySelector('.orbit-count');
		const mark = button.querySelector('.production-mark');
		const progress = button.querySelector('i');
		const bombardment = button.querySelector('.bombardment-label');
		if (
			!(count instanceof HTMLSpanElement) ||
			!(name instanceof HTMLSpanElement) ||
			!(orbit instanceof HTMLSpanElement) ||
			!(mark instanceof HTMLSpanElement) ||
			!(progress instanceof HTMLElement) ||
			!(bombardment instanceof HTMLSpanElement)
		)
			throw new Error('Planet template incomplete');
		name.textContent = p.name;
		planetLayer.append(button);
		views.set(id, { button, count, name, orbit, mark, progress, bombardment });
	}
};
const carrierCommands = document.createElement('div');
carrierCommands.id = 'carrier-commands';
element('command-details', HTMLDivElement).append(carrierCommands);
const raceDestinationButton = document.createElement('button');
raceDestinationButton.id = 'move-to-finish';
raceDestinationButton.textContent = 'Move to destination';
raceDestinationButton.hidden = true;
carrierCommands.append(raceDestinationButton);
raceDestinationButton.addEventListener('click', function () {
	const id = selected.length === 1 ? selected[0] : undefined;
	const destination = destinationFor(world.getResource('objectives'), 'blue');
	if (id === undefined || !destination || busy) return;
	if (moveCarrier(world, id, destination)) {
		sounds.play('command');
		feedback(`Carrier en route to ${destination.label.toLowerCase()}`);
		queueAutosave();
		refresh();
	}
});
const launchCarrierButton = document.createElement('button');
launchCarrierButton.id = 'launch-carrier';
launchCarrierButton.textContent = 'Launch docked ships here';
launchCarrierButton.hidden = true;
carrierCommands.append(launchCarrierButton);
launchCarrierButton.addEventListener('click', function () {
	const id = selected.length === 1 ? selected[0] : undefined;
	if (id === undefined || busy) return;
	const count = launchCarrierShips(world, id, fraction);
	sounds.play(count > 0 ? 'command' : 'error');
	feedback(`${count} ships launched into local space`);
	if (count > 0) queueAutosave();
	refresh();
});
const bombardButton = document.createElement('button');
bombardButton.id = 'bombard-planet';
bombardButton.textContent = 'Bombard planet';
bombardButton.hidden = true;
carrierCommands.append(bombardButton);
bombardButton.addEventListener('click', function () {
	if (busy || multi || selected.length !== 1 || matchEnded(world.getResource('match'))) return;
	choosingDestination = 'bombard';
	mapInput.cancel();
	drawer.close();
	fieldGuide.hidden = true;
	refresh();
	updateLayout();
	board.focus();
});
const cancelBombardButton = document.createElement('button');
cancelBombardButton.id = 'cancel-bombardment';
cancelBombardButton.textContent = 'Cancel bombardment';
cancelBombardButton.hidden = true;
carrierCommands.append(cancelBombardButton);
cancelBombardButton.addEventListener('click', function () {
	const id = selected.length === 1 ? selected[0] : undefined;
	if (id === undefined || busy || !cancelBombardment(world, id)) return;
	feedback('Bombardment cancelled');
	queueAutosave();
	refresh();
});
const labelBounds = function (element: HTMLElement): LabelBounds {
	const rect = element.getBoundingClientRect();
	return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
};
const arrangeLabels = function (): void {
	if (app.hidden) return;
	const labels: MapLabel[] = [];
	const reserved: LabelBounds[] = [];
	for (const [id, view] of views) {
		const owner = world.getComponent(id, 'planet')?.owner;
		const priority = selected.includes(id) || inspected === id ? 1000 : owner === 'blue' ? 400 : owner !== 'neutral' ? 300 : 100;
		reserved.push(view.count.getBoundingClientRect());
		labels.push({ ...labelBounds(view.name), key: `${id}:name`, priority });
		if (view.orbit.textContent) labels.push({ ...labelBounds(view.orbit), key: `${id}:orbit`, priority: priority - 1 });
	}
	for (const panel of document.querySelectorAll<HTMLElement>('.status-cluster, .header-actions, .map-heading, #planet-panel, #orders-drawer, #field-guide, #banner, #destination-prompt, #destination-summary')) {
		if (!panel.hidden && panel.getClientRects().length > 0) reserved.push(panel.getBoundingClientRect());
	}
	for (const label of planetLayer.querySelectorAll<HTMLElement>('.race-destination > span')) {
		label.dataset.placement = 'above';
		for (const placement of ['above', 'below', 'right', 'left']) {
			label.dataset.placement = placement;
			const candidate = { ...labelBounds(label), key: 'destination', priority: 1000 };
			if (visibleMapLabels([candidate], reserved).has('destination')) break;
		}
		reserved.push(labelBounds(label));
	}
	const visible = visibleMapLabels(labels, reserved);
	for (const [id, view] of views) {
		view.name.style.visibility = visible.has(`${id}:name`) ? 'visible' : 'hidden';
		view.orbit.style.visibility = visible.has(`${id}:orbit`) ? 'visible' : 'hidden';
	}
};
const refresh = function (): void {
	if (diagnostics) diagnostics.measure('hud', refreshContent);
	else refreshContent();
};
const refreshContent = function (): void {
	const match = world.getResource('match');
	element('opponent-summary', HTMLParagraphElement).textContent = `${GAME_MODES[world.getResource('objectives').mode].label} · ${mapSides(activeMap).filter(function (side) { return side !== 'blue'; }).length} AI · Free-for-all · ${opponentLabel(match.opponent ?? DEFAULT_OPPONENT)}`;
	const all = planets(world);
	const previousSources = selected.join(',');
	selected = selected.filter(function (id) {
		return (
			world.getComponent(id, 'planet')?.owner === 'blue' ||
			shipsAt(world, id, 'blue').length > 0
		);
	});
	if (
		selected.length === 0 &&
		inspected !== undefined &&
		shipsAt(world, inspected, 'blue').length > 0 &&
		!multi
	)
		selected = [inspected];
	if (previousSources !== selected.join(',')) cancelMapCommand();
	for (const {
		id,
		components: { planet: p },
	} of all) {
		const view = views.get(id);
		if (!view) continue;
		const point = projectMap(p);
		view.button.style.left = `${point.x}px`;
		view.button.style.top = `${point.y}px`;
		view.button.style.setProperty('--heading', `${p.carrier?.heading ?? 0}rad`);
		const docked = dockedShips(world, id).length;
		const blue = shipsAt(world, id, 'blue').length;
		const red = SIDES.filter(function (side) { return side !== 'blue'; }).reduce(function (sum, side) { return sum + shipsAt(world, id, side).length; }, 0);
		const guns = Math.ceil(p.guns);
		const blocked = isBlockaded(world, id);
		const hitSize = Math.max(54, (p.radius + 32) * 2);
		view.button.style.width = `${hitSize}px`;
		view.button.style.height = `${hitSize}px`;
		view.button.style.setProperty('--owner', COLORS[p.owner]);
		view.button.style.setProperty('--diameter', `${p.radius * 2}px`);
		const highlighted = selected.includes(id) || inspected === id;
		view.button.classList.toggle('selected', highlighted);
		view.button.setAttribute('aria-pressed', String(highlighted));
		view.button.setAttribute(
			'aria-label',
			`${p.name}, ${factionLabel(p.owner)} ${p.carrier ? 'carrier' : 'planet'}, ${docked} docked ships, ${p.troops} troops, ${blue} your ships, ${red} rival ships, ${guns} defense platforms${blocked ? ', blockaded' : ''}`,
		);
		const attack = p.carrier?.bombardment;
		const incoming = all.find(function (entry) { return entry.components.planet.carrier?.bombardment?.target === id; });
		const incomingAttack = incoming?.components.planet.carrier?.bombardment;
		const activeAttack = attack ?? incomingAttack;
		const attackingCarrier = attack ? p : incoming?.components.planet;
		const attackTarget = attack ? world.getComponent(attack.target, 'planet') : p;
		const countdown = activeAttack ? `${Math.ceil(CONFIG.bombardmentCharge - activeAttack.elapsed)}s` : '';
		view.bombardment.hidden = !activeAttack;
		view.bombardment.textContent = activeAttack
			? attackingCarrier?.carrier?.destination ? (attack ? `Approaching ${attackTarget?.name ?? 'target'}` : 'Bombardment approaching')
				: `${attack ? 'Bombarding' : 'BOMBARDMENT'} · ${countdown}` : '';
		if (activeAttack) view.button.setAttribute('aria-label', `${view.button.getAttribute('aria-label')}, ${view.bombardment.textContent}`);
		view.count.textContent = String(p.troops);
		view.orbit.replaceChildren();
		for (const side of SIDES) {
			const count = shipsAt(world, id, side).length;
			if (count === 0) continue;
			const span = document.createElement('span');
			span.style.color = COLORS[side];
			span.textContent = `◆${count} `;
			view.orbit.append(span);
		}
		if (p.carrier) view.orbit.append(`▣${docked} docked`);
		if (guns > 0) view.orbit.append(`✣${guns}`);
		view.mark.textContent = p.owner === 'neutral' ? '' : icons[p.production];
		view.progress.style.width = `${(p.progress / CONFIG.cost[p.production]) * 100}%`;
	}
	if (choosingDestination && (selected.length === 0 || matchEnded(match))) cancelMapCommand();
	fleetTargets.update(world, selected.length > 0 && !multi && choosingDestination !== 'bombard' && !matchEnded(match));
	app.classList.toggle('is-dispatching', Boolean(choosingDestination));
	app.classList.toggle('sheet-collapsed', sheetCollapsed);
	element('destination-prompt', HTMLDivElement).hidden = !choosingDestination;
	element('destination-summary', HTMLDivElement).hidden = !choosingDestination;
	element('destination-instruction', HTMLSpanElement).textContent = choosingDestination === 'bombard'
		? 'Choose a planet to bombard' : 'Tap a world to send · hostile groups receive ships only';
	planetPanel.hidden = selected.length === 0 && inspected === undefined;
	dispatchControls.hidden = selected.length === 0;
	dispatchDetails.hidden = selected.length === 0 || commandView === 'production';
	commandActions.hidden = false;
	commandBackButton.hidden = commandView === 'overview';
	app.dataset.commandView = commandView;
	const ownedSelected = selected.flatMap(function (id) {
		const p = world.getComponent(id, 'planet');
		return p?.owner === 'blue' ? [p] : [];
	});
	if (commandView === 'production' && ownedSelected.length === 0) {
		commandView = 'overview';
		dispatchDetails.hidden = selected.length === 0;
		commandActions.hidden = false;
		commandBackButton.hidden = true;
		app.dataset.commandView = commandView;
	}
	productionControls.hidden = ownedSelected.length === 0 || commandView !== 'production';
	openDispatchButton.hidden = selected.length === 0;
	openDispatchButton.disabled = matchEnded(match);
	openDispatchButton.setAttribute('aria-pressed', String(commandView !== 'production'));
	openProductionButton.setAttribute('aria-pressed', String(commandView === 'production'));
	openProductionButton.hidden = ownedSelected.length === 0;
	openProductionButton.disabled = matchEnded(match);
	const shipsOnly = selected.length > 0 && ownedSelected.length === 0;
	dispatchFilterControls.hidden = shipsOnly;
	dispatchInfo.textContent = shipsOnly
		? 'orbiting ships only'
		: 'Platforms stay';
	const first = selected[0] ?? inspected;
	const p =
		first === undefined ? undefined : world.getComponent(first, 'planet');
	selectionName.textContent =
		selected.length > 1
			? `${selected.length} sources selected`
			: p
				? p.name
				: 'No source selected';
	const inspectedOnly = selected.length === 0;
	const forceSources = selected.length > 0 ? selected : first === undefined ? [] : [first];
	const forcePlanets = forceSources.flatMap(function (id) {
		const planet = world.getComponent(id, 'planet');
		return planet ? [planet] : [];
	});
	const carrier = selected.length <= 1 && Boolean(p?.carrier) && (inspectedOnly || p?.owner === 'blue');
	const surfacePlanets = inspectedOnly ? forcePlanets : forcePlanets.filter(function (planet) { return planet.owner === 'blue'; });
	const troops = surfacePlanets.reduce(function (sum, planet) { return sum + planet.troops; }, 0);
	const shipCount = forceSources.reduce(function (sum, id) {
		const side = inspectedOnly ? p?.owner : 'blue';
		return sum + (side && side !== 'neutral' ? availableShips(world, id, side).length : 0);
	}, 0);
	element('stat-troops', HTMLElement).textContent = String(troops);
	element('stat-ships', HTMLElement).textContent = String(carrier && first !== undefined ? dockedShips(world, first).length : shipCount);
	element('stat-platforms', HTMLElement).textContent = String(carrier && first !== undefined
		? SIDES.reduce(function (sum, side) { return sum + shipsAt(world, first, side).length; }, 0)
		: Math.ceil(surfacePlanets.reduce(function (sum, planet) { return sum + planet.guns; }, 0)));
	element('troops-label', HTMLElement).textContent = carrier ? 'Crew' : 'Troops';
	element('ships-label', HTMLElement).textContent = carrier ? 'Docked ships' : shipsOnly ? 'Your ships' : 'Ships';
	element('platforms-label', HTMLElement).textContent = carrier ? 'External ships' : 'Platforms';
	element('selection-kind', HTMLElement).textContent = selected.length > 1 ? 'YOUR SOURCES' :
		`${p?.owner === 'blue' ? 'YOUR' : p ? factionLabel(p.owner).toUpperCase() : 'NEUTRAL'} ${p?.carrier ? 'CARRIER' : 'WORLD'}`;
	selectionInfo.textContent = carrier && p?.owner === 'blue' ? 'Click empty space to move this carrier.' : shipsOnly ? `Your ships in orbit · ${p?.carrier ? 'carrier' : 'surface'} belongs to another faction.` : '';
	if (p?.carrier?.bombardment) {
		const target = world.getComponent(p.carrier.bombardment.target, 'planet');
		selectionInfo.textContent = p.carrier.destination ? `Approaching ${target?.name ?? 'target'} to bombard.`
			: `Bombarding ${target?.name ?? 'target'} · ${Math.ceil(CONFIG.bombardmentCharge - p.carrier.bombardment.elapsed)}s remaining.${p.owner === 'blue' ? ' Moving cancels the charge.' : ''}`;
	}
	selectionInfo.hidden = selectionInfo.textContent === '';
	const friendlyOrbit = first === undefined ? 0 : shipsAt(world, first, 'blue').length;
	const rivalOrbit = first === undefined ? 0 : SIDES.filter(function (side) { return side !== 'blue'; }).reduce(function (sum, side) { return sum + shipsAt(world, first, side).length; }, 0);
	orbitalInfo.hidden = selected.length > 1 || (rivalOrbit === 0 && !shipsOnly && !(carrier && friendlyOrbit > 0));
	orbitalInfo.textContent = `Orbit · ${friendlyOrbit} your ships · ${rivalOrbit} rival ships`;
	const names: Record<Production, string> = { troops: 'Troops', ships: 'Ships', guns: 'Platforms' };
	const progress = p ? Math.floor(p.progress / CONFIG.cost[p.production] * 100) : 0;
	productionInfo.textContent = p && ownedSelected.length === 1 && selected.length === 1
		? `${names[p.production]} · ${progress}%` : 'Selected worlds';
	const progressBar = element('production-progress', HTMLDivElement);
	progressBar.hidden = selected.length !== 1;
	progressBar.setAttribute('aria-valuenow', String(progress));
	const progressFill = progressBar.querySelector('i');
	if (progressFill instanceof HTMLElement) progressFill.style.width = `${progress}%`;
	productionOverview.hidden = ownedSelected.length === 0;
	productionOverview.textContent = `Building ${productionInfo.textContent}`;
	element('production-options', HTMLDivElement).hidden = commandView !== 'production';
	element('change-production', HTMLButtonElement).setAttribute('aria-expanded', String(commandView === 'production'));
	element('change-production', HTMLButtonElement).textContent = 'Done';
	element('sheet-toggle', HTMLButtonElement).setAttribute('aria-expanded', String(!sheetCollapsed));
	element('sheet-toggle', HTMLButtonElement).setAttribute('aria-label', sheetCollapsed ? 'Expand world commands' : 'Collapse world commands');
	element('sheet-toggle', HTMLButtonElement).textContent = sheetCollapsed ? '⌃' : '⌄';
	const preview = previewDispatch(world, selected, fraction, shipsOnly ? 'ships' : filter);
	element('dispatch-preview', HTMLParagraphElement).textContent = `Up to ${preview.troops} troops + ${preview.ships} ships`;
	sendUnitsButton.disabled = busy || preview.troops + preview.ships === 0 || matchEnded(match);
	sendUnitsButton.textContent = preview.troops + preview.ships === 0 ? 'No units available' : 'Choose destination →';
	element('destination-summary', HTMLDivElement).textContent = choosingDestination === 'bombard' ? `${p?.name ?? 'Carrier'} · ${CONFIG.bombardmentCharge}s charge · neutralizes the surface` : `From ${selected.length > 1 ? `${selected.length} sources` : p?.name ?? 'selection'} · up to ${preview.troops} troops + ${preview.ships} ships · groups: ships only`;
	const warning = element('selection-warning', HTMLDivElement);
	const carrierBlocked = p?.carrier && first !== undefined && SIDES.some(function (side) { return isHostile(side, p.owner) && shipsAt(world, first, side).length > 0; });
	warning.textContent = carrierBlocked ? `Docking blocked by hostile ships.${p?.owner === 'blue' ? ' Launching is still allowed.' : ''}` : preview.blockedSources > 0
		? `${preview.blockedSources === 1 ? 'A selected world is' : `${preview.blockedSources} selected worlds are`} blockaded. No units can leave ${preview.blockedSources === 1 ? 'it' : 'them'}.`
		: inspectedOnly && first !== undefined && isBlockaded(world, first) ? 'Surface blockaded by hostile ships.' : '';
	warning.hidden = warning.textContent === '';
	element('panel-multi', HTMLButtonElement).hidden = inspectedOnly;
	element('panel-multi', HTMLButtonElement).textContent = multi ? '✓ Finish selection' : '＋ Multi-select';
	element('panel-multi', HTMLButtonElement).setAttribute('aria-pressed', String(multi));
	element('selection-count', HTMLSpanElement).textContent = selected.length > 0 ? `${selected.length} ${selected.length === 1 ? 'source' : 'sources'} selected` : 'Information only';
	for (const button of productionButtons) {
		button.disabled = ownedSelected.length === 0 || matchEnded(match) || (button.dataset.production === 'guns' && ownedSelected.some(function (p) { return Boolean(p.carrier); }));
		button.setAttribute(
			'aria-pressed',
			String(
				ownedSelected.length > 0 &&
					ownedSelected.every(function (p) {
						return p.production === button.dataset.production;
					}),
			),
		);
	}
	raceDestinationButton.hidden = !destinationFor(world.getResource('objectives'), 'blue') || selected.length !== 1 || !p?.carrier || p.owner !== 'blue';
	raceDestinationButton.disabled = matchEnded(match);
	launchCarrierButton.hidden = !p?.carrier || p.owner !== 'blue' || selected.length !== 1;
	bombardButton.hidden = launchCarrierButton.hidden;
	bombardButton.disabled = matchEnded(match) || multi;
	cancelBombardButton.hidden = launchCarrierButton.hidden || !p?.carrier?.bombardment;
	cancelBombardButton.disabled = matchEnded(match);
	launchCarrierButton.disabled = matchEnded(match) || first === undefined || dockedShips(world, first, 'blue').length === 0;
	carrierCommands.hidden = [raceDestinationButton, launchCarrierButton, bombardButton, cancelBombardButton].every(function (button) { return button.hidden; });
	if (carrier) dispatchInfo.textContent = 'Docked ships can launch';
	instruction.textContent = multi
		? 'Select sources · then finish selection'
		: selected.length
			? p?.carrier && p.owner === 'blue' && selected.length === 1 ? document.documentElement.dataset.input === 'gamepad' ? 'B to return to map · A on empty space sets carrier course' : 'Tap / click empty space to move carrier' : document.documentElement.dataset.input === 'gamepad' ? 'X Dispatch · LB / RB Cycle targets' : 'Choose units below, then choose a destination'
			: 'Select your world or orbital ships';
	multiButton.hidden = selected.length > 0 && !multi;
	multiButton.setAttribute('aria-pressed', String(multi));
	multiButton.textContent = multi ? '✓ Finish selection' : '＋ Multi-select';
	element('score-label', HTMLSpanElement).textContent = activeMap.carriers ? 'HOLDINGS' : 'WORLDS CONTROLLED';
	element('score-label', HTMLSpanElement).title = activeMap.carriers ? 'Worlds and carriers controlled' : 'Worlds controlled';
	blueCount.textContent = String(
		all.filter(function (e) {
			return e.components.planet.owner === 'blue';
		}).length,
	);
	redCount.textContent = String(
		all.filter(function (e) {
			return isHostile(e.components.planet.owner, 'blue');
		}).length,
	);
	clock.textContent = formatElapsedTime(match.time);
	pause.replaceChildren();
	const pauseIcon = document.createElement('span');
	pauseIcon.setAttribute('aria-hidden', 'true');
	pauseIcon.textContent = match.paused ? '▷' : 'Ⅱ';
	const pauseLabel = document.createElement('span');
	pauseLabel.className = 'pause-label';
	pauseLabel.textContent = match.paused ? 'Resume' : 'Pause';
	pause.append(pauseIcon, pauseLabel);
	pause.setAttribute('aria-label', match.paused ? 'Resume game' : 'Pause game');
	pause.setAttribute('aria-pressed', String(match.paused));
	pause.title = match.paused
		? 'Resume game'
		: 'Pause action to issue orders and change production';
	const racing = world.getResource('objectives').mode !== 'conquest';
	const result = match.draw
		? 'Draw. Restart to play again.'
		: match.defeated ? 'Your last holding has fallen. Restart to try again.' : match.winner
			? racing
				? match.winner === 'blue' ? 'You win the carrier race. Restart to play again.' : `${match.winner ? factionLabel(match.winner) : 'A rival'} wins the carrier race. Restart to try again.`
				: match.winner === 'blue' ? 'No rival holdings remain. You win. Restart to play again.' : 'Your last holding has fallen. Restart to try again.'
			: '';
	const threat = all.find(function (entry) {
		const attack = entry.components.planet.carrier?.bombardment;
		return isHostile(entry.components.planet.owner, 'blue') && attack && world.getComponent(attack.target, 'planet')?.owner === 'blue';
	})?.components.planet;
	const threatTarget = threat?.carrier?.bombardment ? world.getComponent(threat.carrier.bombardment.target, 'planet') : undefined;
	const threatWarning = threat?.carrier?.bombardment && threatTarget
		? threat.carrier.destination ? `Enemy carrier approaching ${threatTarget.name} to bombard`
			: `${threatTarget.name} under bombardment · ${Math.ceil(CONFIG.bombardmentCharge - threat.carrier.bombardment.elapsed)}s · Board ${threat.name} to stop it`
		: '';
	bannerMessage.textContent =
		result ||
		threatWarning || presentation.notice() || (match.paused ? 'Paused · commands remain available' : racing ? GAME_MODES[world.getResource('objectives').mode].detail : '');
	banner.style.display = bannerMessage.textContent ? 'block' : 'none';
	const key = match.notices
		.map(function (n) {
			return `${n.time}:${n.text}`;
		})
		.join('|');
	if (key !== lastNoticeKey) {
		lastNoticeKey = key;
		events.replaceChildren(
			...match.notices.slice(0, 3).map(function (n) {
				const row = document.createElement('p');
				row.style.borderColor = COLORS[n.side];
				row.textContent = `${formatElapsedTime(n.time)} ${n.text}`;
				return row;
			}),
		);
	}
	metrics.textContent = `First capture: ${match.firstCapture === null ? '—' : `${match.firstCapture.toFixed(1)}s`} · Orders: ${match.orders} · Captures: ${match.captures} · Transports lost: ${match.transportsLost} (${match.troopsLost} troops, both sides)`;
	aiInput.checked = match.ai;
	drawer.update(
		world,
		selected.length > 0 ? selected : inspected === undefined ? [] : [inspected],
	);
	arrangeLabels();
};

const ordersPanel = element('orders-drawer', HTMLElement);
const drawer = createOrdersDrawer(
	{
		toggle: element('orders-toggle', HTMLButtonElement),
		panel: ordersPanel,
		close: element('close-orders', HTMLButtonElement),
		title: element('orders-title', HTMLHeadingElement),
		showAll: element('show-all-orders', HTMLButtonElement),
		list: element('orders-list', HTMLUListElement),
		empty: element('orders-empty', HTMLParagraphElement),
	},
	function () {
		cancelMapCommand();
		app.classList.remove('is-dispatching');
		element('destination-prompt', HTMLDivElement).hidden = true;
		element('destination-summary', HTMLDivElement).hidden = true;
		fieldGuide.hidden = true;
		settings.setAttribute('aria-expanded', 'false');
		settings.setAttribute('aria-label', 'Open game menu');
	},
	function (message) {
		feedback(message);
		queueAutosave();
		refresh();
	},
);

// The ECSpresso camera pans/zooms projected map coordinates in both layers.
let camera: Camera = presentation.camera();
let fitScale = 1;
let previousArea: ViewportArea | undefined;
const applyCamera = function (): void {
	camera = presentation.camera();
	mapWorld.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
	app.style.setProperty('--map-scale', String(camera.scale));
	arrangeLabels();
};
const playableArea = function (): ViewportArea {
	const width = board.clientWidth;
	const height = board.clientHeight;
	const header = element('app', HTMLDivElement).querySelector('header')?.getBoundingClientRect();
	const top = (header?.bottom ?? 80) + 58;
	const area = { x: 22, y: top, width: Math.max(80, width - 44), height: Math.max(80, height - top - 26) };
	const prompts = document.getElementById('controller-prompts');
	if (prompts && !prompts.hidden && prompts.getClientRects().length > 0) area.height = Math.max(80, prompts.getBoundingClientRect().top - area.y - 18);
	for (const panel of [planetPanel, ordersPanel, fieldGuide, element('destination-summary', HTMLDivElement)]) {
		if (panel.hidden || panel.getClientRects().length === 0) continue;
		const rect = panel.getBoundingClientRect();
		if (panel.id === 'destination-summary' || (window.matchMedia('(max-width: 699px) and (min-height: 551px)').matches && (panel === planetPanel || panel === ordersPanel))) area.height = Math.max(80, rect.top - area.y - 16);
		else area.width = Math.max(80, rect.left - area.x - 22);
	}
	return area;
};
const fitMap = function (): void {
	if (board.clientWidth === 0 || board.clientHeight === 0) return;
	const area = playableArea();
	const fitted = fitIsometricCamera(activeMap, area);
	previousArea = area;
	fitScale = fitted.scale;
	presentation.setCamera(fitted, board.clientWidth, board.clientHeight);
	applyCamera();
};
const revealSelection = function (): void {
	if (board.clientWidth === 0 || board.clientHeight === 0) return;
	const id = selected.at(-1) ?? inspected;
	const planet = id === undefined ? undefined : world.getComponent(id, 'planet');
	if (!planet) return;
	presentation.setCamera(revealPoint(camera, projectMap(planet), playableArea()), board.clientWidth, board.clientHeight);
	applyCamera();
};
const updateLayout = function (): void {
	if (board.clientWidth === 0 || board.clientHeight === 0) return;
	if (!previousArea) { fitMap(); return; }
	const area = playableArea();
	presentation.pan({
		x: area.x + area.width / 2 - previousArea.x - previousArea.width / 2,
		y: area.y + area.height / 2 - previousArea.y - previousArea.height / 2,
	});
	applyCamera();
	previousArea = area;
	revealSelection();
};
const zoomAt = function (anchor: Point, factor: number): void {
	presentation.zoom(anchor, factor, fitScale * 0.5, fitScale * 5);
	applyCamera();
};
const moveOnMap = function (point: Point): void {
		if (choosingDestination) { feedback('Choose a world, carrier, or hostile group as the destination.'); refresh(); return; }
		if (busy || multi || frontMenu.getCurrentScreen() !== 'playing') return;
		const id = selected[0];
		if (selected.length !== 1 || id === undefined || !world.getComponent(id, 'planet')?.carrier) {
			clearSelection();
			refresh();
			updateLayout();
			board.focus({ preventScroll: true });
			return;
		}
		const worldPoint = unprojectMap(presentation.toWorld(point));
		const destination = { x: Math.max(0, Math.min(activeMap.width, worldPoint.x)), y: Math.max(0, Math.min(activeMap.height, worldPoint.y)) };
		if (moveCarrier(world, id, destination)) { sounds.play('command'); feedback('Carrier course set'); queueAutosave(); refresh(); }
};
const mapInput = createMapInput({
	board,
	events: window,
	getPlanetId: function (target): number | undefined {
		const button =
			target instanceof Element ? target.closest('button.planet') : null;
		return [...views].find(function ([, view]) {
			return view.button === button;
		})?.[0];
	},
	selectPlanet: function (id, additive): void {
		if (choosingDestination) sendToPlanet(id);
		else selectPlanet(id, additive);
	},
	dispatchPlanet: sendToPlanet,
	getFleetId: function (target): number | undefined {
		const button = target instanceof Element ? target.closest<HTMLButtonElement>('button.fleet-target') : null;
		const id = Number(button?.dataset.fleet);
		return Number.isSafeInteger(id) && id > 0 ? id : undefined;
	},
	selectFleet: function (id): void {
		if (choosingDestination === 'dispatch') sendToFleet(id);
		else feedback('Hold / right-click a hostile group, or press D to choose an interception target.');
	},
	dispatchFleet: sendToFleet,
	moveTo: moveOnMap,
	cancelCommand: function (): void {
		if (choosingDestination) cancelDispatch();
	},
	panBy: function (delta): void {
		presentation.pan(delta);
		applyCamera();
	},
	zoomAt,
});
const renderer = await createThreeRenderer({
	onContextLost: function (): void {
		world.getResource('match').paused = true;
		feedback('3D view interrupted · the conquest is paused. Resume after the view returns.');
	},
	getViewport: function () { return { width: board.clientWidth, height: board.clientHeight }; },
	canvas,
	getPixelRatio: function (): number {
		return devicePixelRatio;
	},
	getState: function () {
		return {
			world,
			camera,
			fitScale,
			highlighted: drawer.highlighted(),
		};
	},
}).catch(function (error: unknown): never {
	element('menu-profile-status', HTMLParagraphElement).textContent = 'The 3D view could not start. Check that WebGL is enabled, then reload to retry loading the fleet models.';
	throw error;
});
const resizeObserver = new ResizeObserver(updateLayout);
resizeObserver.observe(board);
resizeObserver.observe(planetPanel);
resizeObserver.observe(ordersPanel);
const fieldGuide = element('field-guide', HTMLElement);
resizeObserver.observe(fieldGuide);
resizeObserver.observe(element('destination-summary', HTMLDivElement));
const settings = element('settings', HTMLButtonElement);
const toggleGuide = function (): void {
	if (fieldGuide.hidden && !ordersPanel.hidden) drawer.close();
	cancelMapCommand();
	fieldGuide.hidden = !fieldGuide.hidden;
	settings.setAttribute('aria-expanded', String(!fieldGuide.hidden));
	settings.setAttribute(
		'aria-label',
		fieldGuide.hidden ? 'Open game menu' : 'Close game menu',
	);
	if (fieldGuide.hidden) settings.focus();
	else element('close-guide', HTMLButtonElement).focus();
	refresh();
};
settings.addEventListener('click', toggleGuide);
element('close-guide', HTMLButtonElement).addEventListener(
	'click',
	toggleGuide,
);

const helpDialog = element('help-dialog', HTMLDialogElement);
const howToPlay = element('how-to-play', HTMLButtonElement);
// The title and in-game menu share one authored set of instructions.
element('title-instructions', HTMLElement).replaceChildren(
	...Array.from(element('play-instructions', HTMLElement).children, function (node) {
		return node.cloneNode(true);
	}),
);
howToPlay.addEventListener('click', function () {
	helpDialog.showModal();
	helpDialog.scrollTop = 0;
});
element('close-help', HTMLButtonElement).addEventListener('click', function () {
	helpDialog.close();
});
helpDialog.addEventListener('close', function () {
	howToPlay.focus();
});

const fullscreenButtons = [
	element('fullscreen', HTMLButtonElement),
	element('title-fullscreen', HTMLButtonElement),
];
const titleFullscreenStatus = element('title-fullscreen-status', HTMLElement);
let fullscreenPending = false;
const syncFullscreen = function (): void {
	const active = Boolean(document.fullscreenElement);
	const label = active ? 'Exit fullscreen' : 'Enter fullscreen';
	for (const button of document.querySelectorAll<HTMLButtonElement>('.fullscreen-icon-button')) {
		button.setAttribute('aria-pressed', String(active));
		button.setAttribute('aria-label', label);
		button.innerHTML = `<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">${active
			? '<path d="M5 16h3v3h2v-5H5v2zm3-8H5V5h5v2H7v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>'
			: '<path d="M5 14h2v3h3v2H5v-5zm2-4H5V5h5v2H7v3zm7 7h3v-3h2v5h-5v-2zm3-7V7h-3V5h5v5h-2z"/>'}</svg>`;
		button.disabled = fullscreenPending || !document.fullscreenEnabled;
		button.title = document.fullscreenEnabled
			? label
			: 'Fullscreen unavailable in this browser';
	}
};
const toggleFullscreen = async function (): Promise<void> {
	if (fullscreenPending) return;
	fullscreenPending = true;
	titleFullscreenStatus.textContent = '';
	syncFullscreen();
	try {
		if (document.fullscreenElement) await document.exitFullscreen();
		else await document.documentElement.requestFullscreen();
	} catch {
		const message = 'Fullscreen could not change. Check browser permissions.';
		if (app.hidden) titleFullscreenStatus.textContent = message;
		else {
			feedback(message);
			refresh();
		}
	} finally {
		fullscreenPending = false;
		syncFullscreen();
	}
};
for (const button of fullscreenButtons)
	button.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncFullscreen);
syncFullscreen();

const installGame = async function (
	installation: GameInstallation,
): Promise<void> {
	if (disposed) {
		await installation.game.dispose();
		return;
	}
	mapInput.cancel();
	const previousWorld = world;
	sounds.stop();
	drainSounds(installation.game);
	renderer.reset();
	diagnostics?.dispose();
	diagnostics = undefined;
	world = installation.game;
	attachDiagnostics();
	try {
		world.getResource('match').paused = installation.paused;
		activeProfileId = installation.profileId;
		activeMap = installation.map;
		mapWorld.style.width = `${activeMap.width}px`;
		mapWorld.style.height = `${activeMap.height}px`;
		hiddenPause = installation.hiddenPause;
		hasActiveConquest = true;
		scenario = installation.scenario;
		speed = installation.pace;
		speedSelect.value = String(speed);
		scenarioSelect.value = activeMap === LAB_MAP ? scenario : 'generated';
		clearSelection();
		drawer.reset();
		cancelMapCommand();
		sheetCollapsed = false;
		presentation.clearNotice();
		lastNoticeKey = '';
		fitMap();
		mountPlanets();
		refresh();
		updateSaveStatus(savedStatus(installation.savedAt));
		saveGameButton.disabled = false;
	} finally {
		await previousWorld.dispose();
	}
};

const restart = async function (
	next: Scenario = scenario,
	map: StarMap = activeMap,
	replacementConfirmed = false,
	opponent: OpponentSettings = world.getResource('match').opponent ?? DEFAULT_OPPONENT,
): Promise<void> {
	if (busy) return;
	busy = true;
	app.inert = true;
	if (queuedAutosave !== undefined) {
		window.clearTimeout(queuedAutosave);
		queuedAutosave = undefined;
	}
	mapInput.cancel();
	let replacement: Game | undefined;
	try {
		if (hasActiveConquest && !replacementConfirmed) {
			if (!profileRepository || activeProfileId === null)
				throw new Error('Select a local profile before replacing this conquest.');
			const profiles = await profileRepository.listProfiles();
			const profile = profiles.find(function (candidate) {
				return candidate.id === activeProfileId;
			});
			if (!profile) throw new Error('The active profile is no longer available.');
			if (
				!await confirmAction(
					`Restarting will replace ${profile.name}'s active conquest with a new one. Continue?`,
					'Restart conquest',
				)
			) {
				scenarioSelect.value = activeMap === LAB_MAP ? scenario : 'generated';
				return;
			}
		}
		replacement = await createGame(next, map, undefined, { opponent });
		replacement.getResource('match').paused = document.hidden;
		const profileId = activeProfileId;
		if (!profileRepository || profileId === null)
			throw new Error('Local profile storage is unavailable. The previous conquest was kept.');
		const nextSave = captureConquestSave(
			replacement,
			map,
			next,
			speed,
			profileId,
		);
		try {
			await profileRepository.saveProfile(nextSave);
		} catch (error) {
			const message = saveErrorMessage(error);
			updateSaveStatus(`Save failed · ${message}`);
			throw new Error(
				`The new conquest could not be saved. The previous game and save were kept. ${message}`,
				{ cause: error },
			);
		}
		const gameToInstall = replacement;
		replacement = undefined;
		await installGame({
			game: gameToInstall,
			map,
			scenario: next,
			profileId,
			pace: speed,
			paused: document.hidden,
			hiddenPause: document.hidden,
			savedAt: nextSave.savedAt,
		});
	} catch (error) {
		if (replacement) await replacement.dispose();
		throw error;
	} finally {
		busy = false;
		app.inert = false;
	}
};
for (const button of productionButtons)
	button.addEventListener('click', function () {
		const value = button.dataset.production;
		if (value === 'troops' || value === 'ships' || value === 'guns') {
			setProduction(world, selected, value);
			queueAutosave();
		}
		refresh();
	});
for (const button of amountButtons)
	button.addEventListener('click', function () {
		const value = Number(button.dataset.amount);
		if (![0.25, 0.5, 1].includes(value)) return;
		fraction = value;
		for (const item of amountButtons)
			item.setAttribute('aria-pressed', String(item === button));
		refresh();
	});
for (const button of filterButtons)
	button.addEventListener('click', function () {
		const value = button.dataset.filter;
		if (value !== 'combined' && value !== 'ships' && value !== 'troops') return;
		filter = value;
		for (const item of filterButtons)
			item.setAttribute('aria-pressed', String(item === button));
		refresh();
	});
multiButton.addEventListener('click', function () {
	cancelMapCommand();
	multi = !multi;
	refresh();
});
element('clear', HTMLButtonElement).addEventListener('click', function () {
	clearSelection();
	refresh();
	updateLayout();
	board.focus({ preventScroll: true });
});
element('fit-map', HTMLButtonElement).addEventListener('click', function () {
	fitMap();
	board.focus({ preventScroll: true });
});
for (const [id, factor] of [['zoom-in', 1.25], ['zoom-out', 0.8]] as const) {
	element(id, HTMLButtonElement).addEventListener('click', function () {
		const area = playableArea();
		zoomAt({ x: area.x + area.width / 2, y: area.y + area.height / 2 }, factor);
	});
}
const cancelDispatch = function (): void {
	const command = choosingDestination;
	cancelMapCommand();
	refresh();
	updateLayout();
	const button = element('bombard-planet', HTMLButtonElement);
	if (command === 'bombard' && !button.hidden && !button.disabled && !sheetCollapsed) button.focus({ preventScroll: true });
	else if (commandView !== 'production' && !sendUnitsButton.disabled && !sheetCollapsed) sendUnitsButton.focus({ preventScroll: true });
	else board.focus({ preventScroll: true });
};
const beginDispatch = function (): void {
	if (busy || selected.length === 0 || choosingDestination || matchEnded(world.getResource('match'))) return;
	const shipsOnly = selected.every(function (id) { return world.getComponent(id, 'planet')?.owner !== 'blue'; });
	const preview = previewDispatch(world, selected, fraction, shipsOnly ? 'ships' : filter);
	if (preview.troops + preview.ships === 0) return;
	multi = false;
	choosingDestination = 'dispatch';
	mapInput.cancel();
	drawer.close();
	fieldGuide.hidden = true;
	refresh();
	updateLayout();
	board.focus({ preventScroll: true });
};
sendUnitsButton.addEventListener('click', beginDispatch);
element('cancel-dispatch', HTMLButtonElement).addEventListener('click', cancelDispatch);
const showCommandView = function (view: CommandView | 'dispatch'): void {
	cancelMapCommand();
	commandView = view === 'dispatch' ? 'overview' : view;
	sheetCollapsed = false;
	refresh();
	updateLayout();
	const focusTarget = view === 'dispatch'
		? amountButtons.find(function (button) { return button.getAttribute('aria-pressed') === 'true'; })
		: view === 'production'
			? productionButtons.find(function (button) { return button.getAttribute('aria-pressed') === 'true' && !button.disabled; })
			: openDispatchButton.hidden ? selectionOrdersButton : openDispatchButton;
	focusTarget?.focus({ preventScroll: true });
};
openDispatchButton.addEventListener('click', function () { showCommandView('dispatch'); });
openProductionButton.addEventListener('click', function () { showCommandView('production'); });
commandBackButton.addEventListener('click', function () { showCommandView('overview'); });
selectionOrdersButton.addEventListener('click', function () {
	cancelMapCommand();
	element('orders-toggle', HTMLButtonElement).click();
});
element('panel-multi', HTMLButtonElement).addEventListener('click', function () { multiButton.click(); });
element('change-production', HTMLButtonElement).addEventListener('click', function () {
	showCommandView('overview');
});
element('sheet-toggle', HTMLButtonElement).addEventListener('click', function () {
	sheetCollapsed = !sheetCollapsed;
	refresh();
	updateLayout();
});
pause.addEventListener('click', function () {
	const match = world.getResource('match');
	match.paused = !match.paused;
	queueAutosave();
	refresh();
});
element('restart', HTMLButtonElement).addEventListener('click', function () {
	void restart().catch(function (error) {
		feedback(saveErrorMessage(error));
	});
});
scenarioSelect.addEventListener('change', function () {
	const next = scenarioSelect.value;
	if (next === 'skirmish' || next === 'blockade' || next === 'invasion')
		void restart(next, LAB_MAP).catch(function (error) {
			feedback(saveErrorMessage(error));
		});
});
speedSelect.addEventListener('change', function () {
	const nextSpeed = Number(speedSelect.value);
	if (nextSpeed !== 0.5 && nextSpeed !== 1 && nextSpeed !== 2) return;
	speed = nextSpeed;
	queueAutosave();
});
aiInput.addEventListener('change', function () {
	world.getResource('match').ai = aiInput.checked;
	queueAutosave();
});
let previous = performance.now();
let lastRefresh = 0;
let soundWorldPaused = true;
const frame = function (now: number): void {
	if (disposed) return;
	const dt = Math.min(Math.max((now - previous) / 1000, 0), 0.1);
	previous = now;
	sounds.setActive(!document.hidden && document.hasFocus());
	updateGamepad(dt);
	presentation.update(dt);
	diagnostics?.frame(now);
	if (!busy && frontMenu.getCurrentScreen() === 'playing') {
		// Keep rendering and command input live while simulation time is frozen.
		if (!world.getResource('match').paused) {
			if (diagnostics) diagnostics.measure('simulation', function () { world.update(dt * speed); });
			else world.update(dt * speed);
		}
		if (diagnostics) diagnostics.measure('draw', function () { renderer.draw(); });
		else renderer.draw();
		if (now - lastRefresh > 100) {
			refresh();
			lastRefresh = now;
		}
	}
	const soundPaused = busy || frontMenu.getCurrentScreen() !== 'playing' || world.getResource('match').paused;
	if (soundPaused && !soundWorldPaused) sounds.stop();
	soundWorldPaused = soundPaused;
	// Always drain, including while muted or blocked by autoplay: no old battle
	// or result cues should play when sound is enabled or a tab returns.
	for (const event of drainSounds(world)) {
		if (soundPaused) continue;
		const point = event.point ? projectMap(event.point) : undefined;
		const screenX = point ? camera.x + point.x * camera.scale : board.clientWidth / 2;
		const pan = board.clientWidth > 0 ? (screenX / board.clientWidth - 0.5) * 1.6 : 0;
		sounds.play(event.kind, pan, event.point ? 0.7 : 1);
	}
	raf = requestAnimationFrame(frame);
};
world.getResource('match').paused = true;
saveGameButton.disabled = true;
const continueProfile = async function (profileId: string): Promise<void> {
	if (!profileRepository) throw new Error('IndexedDB local storage is unavailable.');
	const save = await profileRepository.loadSave(profileId);
	if (!save) throw new Error('This profile has no saved conquest to continue.');
	let replacement: Game | undefined;
	try {
		replacement = await createGame(
			save.game.scenario,
			save.game.map,
			save.game,
		);
		replacement.getResource('match').paused = true;
		const restoredMap = sameMap(save.game.map, LAB_MAP)
			? LAB_MAP
			: structuredClone(save.game.map);
		const gameToInstall = replacement;
		replacement = undefined;
		await installGame({
			game: gameToInstall,
			map: restoredMap,
			scenario: save.game.scenario,
			profileId,
			pace: save.game.pace,
			paused: true,
			hiddenPause: false,
			savedAt: save.savedAt,
		});
	} catch (error) {
		if (replacement) await replacement.dispose();
		throw error;
	}
};
const frontMenu = await createFrontMenu({
	start: async function (map, opponent) {
		await restart('skirmish', map, true, opponent);
	},
	continue: continueProfile,
	profiles: profileRepository,
	initialProfiles,
	initialSelectedProfileId: activeProfileId,
	storageMessage: profileStorageMessage,
	beforeProfileChange: async function () {
		await saveCurrentProfile();
	},
	onProfileChange: function (profileId) {
		activeProfileId = profileId;
		hasActiveConquest = false;
		updateSaveStatus(profileId ? 'No active conquest' : 'Not saved');
		saveGameButton.disabled = true;
	},
	onMenu: function () {
		sounds.stop();
		cancelMapCommand();
		world.getResource('match').paused = true;
		hiddenPause = false;
	},
	onPlaying: function () {
		fitMap();
		refresh();
		board.focus();
		void saveCurrentProfile().catch(function () {});
	},
});

const inputListeners = new AbortController();
const controllerCursor = element('gamepad-cursor', HTMLDivElement);
const controllerStatus = element('controller-status', HTMLDivElement);
const controllerPrompts = document.createElement('div');
controllerPrompts.id = 'controller-prompts';
controllerPrompts.setAttribute('aria-label', 'Controller controls');
controllerPrompts.hidden = true;
app.append(controllerPrompts);
let cursor: Point = { x: innerWidth / 2, y: innerHeight / 2 };
let snappedTarget: HTMLElement | undefined;
const currentDialog = function (): HTMLDialogElement | undefined {
	return [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
};
const menuControlRoot = function (): HTMLElement | undefined {
	const dialog = currentDialog();
	if (dialog) return dialog;
	const screen = frontMenu.getCurrentScreen();
	if (screen !== 'playing') return screen === 'title'
		? element('title-screen', HTMLElement).querySelector<HTMLElement>('.main-menu') ?? undefined
		: element('setup', HTMLElement);
	if (!fieldGuide.hidden) return fieldGuide;
	if (!ordersPanel.hidden) return ordersPanel;
	return document.activeElement instanceof Node && planetPanel.contains(document.activeElement) && !planetPanel.hidden ? planetPanel : undefined;
};
const setInputMethod = function (method: 'gamepad' | 'keyboard' | 'mouse' | 'touch'): void {
	document.documentElement.dataset.input = method;
	if (method !== 'gamepad') { controllerCursor.hidden = true; controllerPrompts.hidden = true; }
};
window.addEventListener('pointerdown', function (event) {
	setInputMethod(event.pointerType === 'touch' ? 'touch' : 'mouse');
}, { capture: true, signal: inputListeners.signal });
window.addEventListener('pointermove', function (event) {
	if (event.pointerType === 'mouse' && (event.movementX !== 0 || event.movementY !== 0)) setInputMethod('mouse');
}, { capture: true, signal: inputListeners.signal });
document.addEventListener('keydown', function (event) {
	const dialog = currentDialog();
	if (!dialog) return;
	if (event.key === 'Escape') { event.stopPropagation(); return; }
	if (event.target instanceof HTMLInputElement && event.target.type === 'text') return;
	if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
	event.preventDefault(); event.stopPropagation();
	moveFocus(dialog, event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : event.key === 'ArrowLeft' ? 'left' : 'right');
}, { capture: true, signal: inputListeners.signal });
window.addEventListener('keydown', function (event) {
	if (event.isTrusted) setInputMethod('keyboard');
}, { capture: true, signal: inputListeners.signal });
const gamepad = await createGamepadInput({
	onActivity: function () { setInputMethod('gamepad'); },
	onClaim: function () {
		sounds.unlock();
		if (frontMenu.getCurrentScreen() === 'playing') {
			world.getResource('match').paused = true;
			hiddenPause = false;
			cancelMapCommand();
			refresh();
			board.focus({ preventScroll: true });
		} else {
			const root = menuControlRoot();
			if (root && !(document.activeElement instanceof Node && root.contains(document.activeElement))) visibleControls(root)[0]?.focus({ preventScroll: true });
		}
	},
	onDisconnect: function () {
		if (frontMenu.getCurrentScreen() === 'playing') {
			world.getResource('match').paused = true;
			hiddenPause = false;
			cancelMapCommand();
			refresh();
			updateLayout();
		}
	},
});
document.addEventListener('visibilitychange', function () {
	gamepad.suspend();
	if (document.hidden && document.documentElement.dataset.input === 'gamepad') {
		world.getResource('match').paused = true;
		hiddenPause = false;
	}
}, { signal: inputListeners.signal });
window.addEventListener('blur', function () {
	gamepad.suspend();
	if (document.documentElement.dataset.input === 'gamepad' && frontMenu.getCurrentScreen() === 'playing') {
		world.getResource('match').paused = true;
		hiddenPause = false;
		cancelMapCommand();
		refresh();
	}
}, { signal: inputListeners.signal });
const backFromController = function (): void {
	const dialog = currentDialog();
	if (dialog) { dialog.close('cancel'); return; }
	if (frontMenu.getCurrentScreen() !== 'playing') {
		if (frontMenu.getCurrentScreen() !== 'title') element('back', HTMLButtonElement).click();
		return;
	}
	if (choosingDestination) { cancelDispatch(); return; }
	if (!ordersPanel.hidden) { drawer.close(); board.focus({ preventScroll: true }); return; }
	if (!fieldGuide.hidden) { toggleGuide(); return; }
	if (commandView !== 'overview') { showCommandView('overview'); return; }
	if (document.activeElement instanceof Node && planetPanel.contains(document.activeElement)) {
		board.focus({ preventScroll: true });
		return;
	}
	if (selected.length > 0 || inspected !== undefined) {
		clearSelection(); refresh(); updateLayout(); board.focus({ preventScroll: true }); return;
	}
	toggleGuide();
};
const pointAtTarget = function (target: HTMLElement): void {
	const id = [...views].find(function ([, view]) { return view.button === target; })?.[0];
	const planet = id === undefined ? undefined : world.getComponent(id, 'planet');
	const point = planet ? projectMap(planet) : { x: Number(target.style.left.replace('px', '')), y: Number(target.style.top.replace('px', '')) };
	if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
		presentation.setCamera(revealPoint(camera, point, playableArea()), board.clientWidth, board.clientHeight);
		applyCamera();
	}
	const box = target.getBoundingClientRect();
	cursor = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
	target.focus({ preventScroll: true });
};
const cycleMapTarget = function (delta: number): void {
	const targets = [...board.querySelectorAll<HTMLElement>('button.planet, button.fleet-target')].filter(function (target) {
		return !target.closest('[hidden]') && !target.matches(':disabled');
	});
	if (targets.length === 0) return;
	const previous = targets.findIndex(function (target) { return target === snappedTarget; });
	const own = [...views].find(function ([id]) { return world.getComponent(id, 'planet')?.owner === 'blue'; })?.[1].button;
	const target = targets[previous < 0 ? Math.max(0, targets.findIndex(function (entry) { return entry === own; })) : (previous + delta + targets.length) % targets.length];
	if (!target) return;
	snappedTarget = target;
	pointAtTarget(target);
};
const confirmMapTarget = function (): void {
	const hit = document.elementFromPoint(cursor.x, cursor.y);
	const target = snappedTarget?.isConnected && !snappedTarget.closest('[hidden]') && !snappedTarget.matches(':disabled') ? snappedTarget : hit?.closest<HTMLElement>('button.planet, button.fleet-target');
	const id = target ? [...views].find(function ([, view]) { return view.button === target; })?.[0] : undefined;
	if (id !== undefined) {
		if (choosingDestination) { sendToPlanet(id); board.focus({ preventScroll: true }); }
		else {
			selectPlanet(id);
			if (!multi && selected.length > 0) {
				snappedTarget = target ?? undefined;
				showCommandView('overview');
			}
		}
	} else if (target?.dataset.fleet) {
		const fleet = Number(target.dataset.fleet);
		if (choosingDestination === 'dispatch' && Number.isSafeInteger(fleet)) sendToFleet(fleet);
	} else if (hit?.closest('#board')) moveOnMap(cursor);
};
const updateGamepad = function (dt: number): void {
	if (document.hidden || !document.hasFocus()) { gamepad.suspend(); controllerCursor.hidden = true; return; }
	const input: GamepadFrame = gamepad.update(dt);
	if (input.actions.length > 0 || input.directions.length > 0) sounds.unlock();
	const status = gamepad.status();
	const active = document.documentElement.dataset.input === 'gamepad';
	const message = status.phase === 'disconnected' && active
		? 'Controller disconnected. Game paused. Reconnect, then press A or Start. Keyboard and touch remain available.'
		: status.phase === 'arming' ? 'Release the controller controls to continue.'
			: status.phase === 'unclaimed' && status.available > 0 ? 'Press A or Start to use your controller.' : '';
	controllerStatus.textContent = message;
	controllerStatus.hidden = message === '';
	if ((busy && !currentDialog()) || status.phase !== 'active' || !active) { controllerCursor.hidden = true; controllerPrompts.hidden = true; return; }
	const root = menuControlRoot();
	const playing = frontMenu.getCurrentScreen() === 'playing';
	const dialog = currentDialog();
	if (root) {
		for (const direction of input.directions) moveFocus(root, direction);
		if (input.panY !== 0) root.scrollTop += input.panY * 550 * dt;
	}
	if (playing && !root) {
		const area = playableArea();
		const moving = Math.abs(input.moveX) + Math.abs(input.moveY) > 0;
		if (!moving && snappedTarget?.isConnected && input.panX === 0 && input.panY === 0 && input.zoom === 0) {
			const box = snappedTarget.getBoundingClientRect();
			cursor = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		}
		if (moving) {
			snappedTarget = undefined;
			board.focus({ preventScroll: true });
		}
		const nudge = moving ? { x: 0, y: 0 } : input.directions.reduce(function (point, direction) {
			return { x: point.x + (direction === 'left' ? -45 : direction === 'right' ? 45 : 0), y: point.y + (direction === 'up' ? -45 : direction === 'down' ? 45 : 0) };
		}, { x: 0, y: 0 });
		if (nudge.x !== 0 || nudge.y !== 0) snappedTarget = undefined;
		cursor = { x: Math.max(area.x, Math.min(area.x + area.width, cursor.x + input.moveX * 570 * dt + nudge.x)), y: Math.max(area.y, Math.min(area.y + area.height, cursor.y + input.moveY * 570 * dt + nudge.y)) };
		if (Math.abs(input.panX) + Math.abs(input.panY) > 0) {
			presentation.pan({ x: -input.panX * 650 * dt, y: -input.panY * 650 * dt }); applyCamera(); snappedTarget = undefined;
		}
		if (input.zoom !== 0) { zoomAt(cursor, Math.exp(input.zoom * dt * 1.7)); snappedTarget = undefined; }
	}
	for (const action of input.actions) {
		if (action === 'back') { backFromController(); break; }
		if (action === 'confirm') {
			if (root) activateControl(root);
			else if (playing) confirmMapTarget();
			break;
		}
		if (dialog) continue;
		if (action === 'multi') {
			if (playing && fieldGuide.hidden && ordersPanel.hidden) { multiButton.click(); board.focus({ preventScroll: true }); }
			else if (frontMenu.getCurrentScreen() === 'title') element('profile-badge', HTMLButtonElement).click();
		} else if (playing && action === 'pause') pause.click();
		else if (playing && action === 'menu') toggleGuide();
		else if (playing && fieldGuide.hidden && ordersPanel.hidden && action === 'dispatch' && selected.length > 0) {
			if (choosingDestination) cancelDispatch();
			else if (root === planetPanel) beginDispatch();
			else showCommandView('dispatch');
		}
		else if (action === 'previousTarget' || action === 'nextTarget') {
			if (playing && fieldGuide.hidden && ordersPanel.hidden) cycleMapTarget(action === 'previousTarget' ? -1 : 1);
			else if (root) moveFocus(root, action === 'previousTarget' ? 'up' : 'down');
		}
	}
	const onMap = frontMenu.getCurrentScreen() === 'playing' && !menuControlRoot();
	controllerCursor.hidden = !onMap;
	controllerCursor.style.left = `${cursor.x}px`;
	controllerCursor.style.top = `${cursor.y}px`;
	controllerPrompts.hidden = !playing || Boolean(dialog);
	const prompts: readonly (readonly [string, string])[] = onMap
		? choosingDestination ? [['A', 'Confirm target'], ['B', 'Cancel'], ['LB/RB', 'Targets'], ['RS', 'Pan'], ['LT/RT', 'Zoom']]
			: [['A', 'Select / command'], ['X', 'Dispatch'], ['Y', 'Multi-select'], ['LB/RB', 'Targets'], ['Start', 'Pause']]
		: root === planetPanel ? [['A', 'Select'], ['X', 'Choose destination'], ['B', commandView === 'production' ? 'Back' : 'Map'], ['D-pad', 'Navigate']]
			: [['A', 'Select'], ['B', 'Back'], ['D-pad', 'Navigate'], ['Start', 'Pause']];
	const promptKey = prompts.map(function (entry) { return entry.join(':'); }).join('|');
	if (controllerPrompts.dataset.state !== promptKey) {
		controllerPrompts.dataset.state = promptKey;
		controllerPrompts.replaceChildren(...prompts.map(function ([button, label]) {
			const entry = document.createElement('span');
			const glyph = document.createElement('kbd');
			glyph.textContent = button;
			entry.append(glyph, label);
			return entry;
		}));
	}

};

const autosaveTimer = window.setInterval(function () {
	const screen = frontMenu.getCurrentScreen();
	if (busy || screen !== 'playing') return;
	void saveCurrentProfile().catch(function () {});
}, 15_000);
saveGameButton.addEventListener('click', function () {
	if (busy) return;
	void saveCurrentProfile().catch(function () {});
});
element('profiles-game', HTMLButtonElement).addEventListener('click', async function () {
	if (busy || !(await saveBeforeLeavingGame())) return;
	drawer.reset();
	fieldGuide.hidden = true;
	settings.setAttribute('aria-expanded', 'false');
	settings.setAttribute('aria-label', 'Open game menu');
	await frontMenu.setScreen('title', {});
});
element('setup-game', HTMLButtonElement).addEventListener('click', async function () {
	if (busy) return;
	if (!(await saveBeforeLeavingGame())) return;
	drawer.reset();
	fieldGuide.hidden = true;
	settings.setAttribute('aria-expanded', 'false');
	settings.setAttribute('aria-label', 'Open game menu');
	await frontMenu.setScreen('setup', {});
});
document.addEventListener('visibilitychange', function () {
	previous = performance.now();
	if (frontMenu.getCurrentScreen() !== 'playing') return;
	if (document.hidden) {
		mapInput.cancel();
		hiddenPause = !world.getResource('match').paused;
		world.getResource('match').paused = true;
	} else if (hiddenPause) {
		world.getResource('match').paused = false;
		hiddenPause = false;
	}
});
window.addEventListener('keydown', function (event) {
	if (frontMenu.getCurrentScreen() !== 'playing' || busy || event.repeat) return;
	if (event.key === 'Escape') {
		event.preventDefault();
		if (choosingDestination) { cancelDispatch(); return; }
		if (!ordersPanel.hidden) {
			drawer.close();
			return;
		}
		if (!fieldGuide.hidden) { toggleGuide(); return; }
		if (commandView !== 'overview') { showCommandView('overview'); return; }
		clearSelection();
		refresh();
		updateLayout();
		board.focus({ preventScroll: true });
	}
	if (event.altKey || event.ctrlKey || event.metaKey) return;
	const mapFocused = event.target === document.body || event.target === board;
	const gameplayFocused = mapFocused || event.target instanceof Node && app.contains(event.target);
	const editing = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
	if (!editing && !event.defaultPrevented && (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
		const root = menuControlRoot();
		if (root) { event.preventDefault(); moveFocus(root, event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : event.key === 'ArrowLeft' ? 'left' : 'right'); }
	}
	if (event.key.toLowerCase() === 'd' && gameplayFocused && !editing && fieldGuide.hidden && ordersPanel.hidden) {
		event.preventDefault();
		beginDispatch();
	}
	if (event.key === 'Home' && (mapFocused || event.target instanceof Node && board.contains(event.target))) {
		event.preventDefault();
		fitMap();
	}
	if (event.code === 'Space' && mapFocused) {
		event.preventDefault();
		pause.click();
	}
});
const attachDiagnostics = function (): void {
	if (!diagnosticsEnabled) return;
	diagnostics = createPerformanceDiagnostics(world, function () {
		const all = units(world);
		return { renderer: renderer.inspect(), scenario, map: activeMap, pace: speed, camera, simulationTime: world.getResource('match').time,
			ships: all.filter(function (entity) { return entity.components.unit.kind === 'ship'; }).length,
			transports: all.filter(function (entity) { return entity.components.unit.kind === 'transport'; }).length,
			screen: frontMenu.getCurrentScreen(), viewport: {
			width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
			userAgent: navigator.userAgent, paused: world.getResource('match').paused,
			visibility: document.visibilityState };
	});
	diagnostics.setEnabled(true);
};
// Developer API is exposed only with the explicit URL opt-in.
if (diagnosticsEnabled) {
	let baselineProfileId: string | undefined;
	const api = {
		enable: function (enabled: boolean): void {
			diagnosticsEnabled = enabled;
			diagnostics?.dispose(); diagnostics = undefined;
			attachDiagnostics();
		},
		report: function (): DiagnosticsReport | undefined { return diagnostics?.report(); },
		reset: function (): void { diagnostics?.reset(); },
		carrierPreview: async function (scenario: import('./carrier-preview').CarrierPreview): Promise<void> {
			if (disposed || busy || !profileRepository) throw new Error('Carrier preview requires idle local storage');
			if (!(await saveBeforeLeavingGame())) throw new Error('Current conquest could not be saved');
			busy = true;
			let replacement: Game | undefined;
			try {
				if (!baselineProfileId) baselineProfileId = (await profileRepository.createProfile('Carrier review')).id;
				const { createCarrierPreview } = await import('./carrier-preview');
				const preview = await createCarrierPreview(scenario);
				replacement = preview.game;
				const save = captureConquestSave(replacement, preview.map, 'skirmish', 1, baselineProfileId);
				await profileRepository.saveProfile(save);
				await profileRepository.setSelectedProfileId(baselineProfileId);
				const game = replacement; replacement = undefined;
				await installGame({ game, map: preview.map, scenario: 'skirmish', profileId: baselineProfileId, pace: 1, paused: true, hiddenPause: false, savedAt: save.savedAt });
				await frontMenu.setScreen('playing', {});
			} finally { await replacement?.dispose(); busy = false; }
		},
		baseline: async function (): Promise<void> {
			if (disposed || busy || !profileRepository)
				throw new Error('Baseline requires idle local storage');
			if (!(await saveBeforeLeavingGame()))
				throw new Error('Current conquest could not be saved');
			busy = true;
			let replacement: Game | undefined;
			try {
				// Reuse this session's dedicated profile; preserve all existing conquests.
				if (!baselineProfileId) {
					const profile = await profileRepository.createProfile('Performance baseline v1');
					baselineProfileId = profile.id;
				}
				const snapshot = createCrowdedBaseline();
				replacement = await createGame(snapshot.scenario, snapshot.map, snapshot);
				const save = captureConquestSave(replacement, LAB_MAP, 'skirmish', 1, baselineProfileId);
				await profileRepository.saveProfile(save);
				await profileRepository.setSelectedProfileId(baselineProfileId);
				const game = replacement;
				replacement = undefined;
				await installGame({ game, map: LAB_MAP, scenario: 'skirmish',
					profileId: baselineProfileId, pace: 1, paused: false,
					hiddenPause: false, savedAt: save.savedAt });
				if (disposed) return;
				await frontMenu.setScreen('playing', {});
				world.getResource('match').paused = false;
				diagnostics?.reset();
			} finally {
				await replacement?.dispose();
				busy = false;
			}
		},
	};
	Object.defineProperty(window, 'conquestDiagnostics', { value: api, configurable: true });
	attachDiagnostics();
}
raf = requestAnimationFrame(frame);
window.addEventListener('pagehide', function (event) {
	sounds.setActive(false);
	if (event.persisted) return;
	disposed = true;
	soundListeners.abort();
	void sounds.dispose();
	inputListeners.abort();
	void gamepad.dispose();
	diagnostics?.dispose();
	diagnostics = undefined;
	Reflect.deleteProperty(window, 'conquestDiagnostics');
	mapInput.dispose();
	void renderer.dispose();
	cancelAnimationFrame(raf);
	if (autosaveTimer !== undefined) window.clearInterval(autosaveTimer);
	if (queuedAutosave !== undefined) window.clearTimeout(queuedAutosave);
	resizeObserver.disconnect();
	void presentation.dispose();
	void world.dispose();
	void frontMenu.dispose();
	profileRepository?.close();
});
