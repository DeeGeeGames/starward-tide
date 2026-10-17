import { createOrdersDrawer } from './orders-drawer';
import { zoomCamera } from './camera';
import type { Camera, Point } from './camera';
import { CONFIG, COLORS } from './config';
import { LAB_MAP } from './maps';
import type { StarMap } from './maps';
import { createFrontMenu } from './front-menu';
import type { DispatchFilter, Production, Scenario, Side } from './config';
import { captureConquestSave } from './game-save';
import {
	createGame,
	dispatch,
	isBlockaded,
	planets,
	orderUnits,
	setProduction,
	shipsAt,
	unitPoint,
	units,
} from './game';
import type { Game } from './game';
import { openProfileRepository } from './profile-storage';
import type { ProfileRepository, ProfileSummary } from './profile-storage';

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
const canvas = element('space', HTMLCanvasElement);
const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas 2D is required');
const ctx = context;
const planetLayer = element('planets', HTMLDivElement);
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
const productionButtons = [
	...document.querySelectorAll<HTMLButtonElement>('[data-production]'),
];
const amountButtons = [
	...document.querySelectorAll<HTMLButtonElement>('[data-amount]'),
];
const filterButtons = [
	...document.querySelectorAll<HTMLButtonElement>('[data-filter]'),
];
interface PlanetView {
	button: HTMLButtonElement;
	count: HTMLSpanElement;
	orbit: HTMLSpanElement;
	mark: HTMLSpanElement;
	progress: HTMLElement;
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
let noticeUntil = 0;
let orderMessage = '';
let lastNoticeKey = '';
let hiddenPause = false;
const icons: Record<Production, string> = {
	troops: '▥',
	ships: '◆',
	guns: '✣',
};
const WARSHIP_HULL = new Path2D();
WARSHIP_HULL.moveTo(12, -1.5);
WARSHIP_HULL.lineTo(12, 1.5);
WARSHIP_HULL.lineTo(9, 4.5);
WARSHIP_HULL.lineTo(6, 5.5);
WARSHIP_HULL.lineTo(3, 7);
WARSHIP_HULL.lineTo(-6, 7);
WARSHIP_HULL.lineTo(-8, 5);
WARSHIP_HULL.lineTo(-11, 5);
WARSHIP_HULL.lineTo(-13, 3.5);
WARSHIP_HULL.lineTo(-13, -3.5);
WARSHIP_HULL.lineTo(-11, -5);
WARSHIP_HULL.lineTo(-8, -5);
WARSHIP_HULL.lineTo(-6, -7);
WARSHIP_HULL.lineTo(3, -7);
WARSHIP_HULL.lineTo(6, -5.5);
WARSHIP_HULL.lineTo(9, -4.5);
WARSHIP_HULL.closePath();
const TRANSPORT_HULL = new Path2D();
TRANSPORT_HULL.moveTo(10, -2.5);
TRANSPORT_HULL.lineTo(10, 2.5);
TRANSPORT_HULL.lineTo(7, 5);
TRANSPORT_HULL.lineTo(2, 5);
TRANSPORT_HULL.lineTo(2, 10);
TRANSPORT_HULL.lineTo(-7, 10);
TRANSPORT_HULL.lineTo(-8.5, 8.5);
TRANSPORT_HULL.lineTo(-8.5, 4);
TRANSPORT_HULL.lineTo(-10.5, 4);
TRANSPORT_HULL.lineTo(-10.5, -4);
TRANSPORT_HULL.lineTo(-8.5, -4);
TRANSPORT_HULL.lineTo(-8.5, -8.5);
TRANSPORT_HULL.lineTo(-7, -10);
TRANSPORT_HULL.lineTo(2, -10);
TRANSPORT_HULL.lineTo(2, -5);
TRANSPORT_HULL.lineTo(7, -5);
TRANSPORT_HULL.closePath();
const UNIT_SHADE: Record<Side, string> = {
	blue: '#17485b',
	red: '#753f42',
};
const UNIT_HIGHLIGHT: Record<Side, string> = {
	blue: '#dcf7ff',
	red: '#ffebe5',
};
const drawWarship = function (owner: Side, zoom: number): void {
	ctx.fillStyle = COLORS[owner];
	ctx.strokeStyle = '#142a38';
	ctx.lineWidth = 1;
	ctx.fill(WARSHIP_HULL);
	ctx.stroke(WARSHIP_HULL);
	if (zoom >= 1.75) {
		ctx.fillStyle = UNIT_SHADE[owner];
		ctx.fillRect(-2, -2.5, 6, 5);
		ctx.fillRect(1, -1.3, 4.5, 2.6);
		for (const x of [-5.5, 5.5]) {
			ctx.beginPath();
			ctx.arc(x, 0, 2.1, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.strokeStyle = UNIT_HIGHLIGHT[owner];
		ctx.lineWidth = 0.7;
		ctx.beginPath();
		ctx.moveTo(-1, -1.6);
		ctx.lineTo(3.5, -1.6);
		ctx.moveTo(-1, 1.6);
		ctx.lineTo(3.5, 1.6);
		ctx.stroke();
	}
	if (zoom >= 2.5) {
		ctx.strokeStyle = UNIT_SHADE[owner];
		ctx.lineWidth = 1.2;
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.moveTo(5.5, -0.5);
		ctx.lineTo(9.3, -0.5);
		ctx.moveTo(5.5, 0.5);
		ctx.lineTo(9.3, 0.5);
		ctx.moveTo(-5.5, -0.5);
		ctx.lineTo(-8.8, -0.5);
		ctx.moveTo(-5.5, 0.5);
		ctx.lineTo(-8.8, 0.5);
		ctx.stroke();
		ctx.fillStyle = UNIT_HIGHLIGHT[owner];
		ctx.fillRect(-13, -3, 1.5, 2);
		ctx.fillRect(-13, 1, 1.5, 2);
	}
};
const drawTroopTransport = function (
	owner: Side,
	cargo: number,
	zoom: number,
	scale: number,
	angle: number,
): void {
	ctx.fillStyle = COLORS[owner];
	ctx.strokeStyle = '#142a38';
	ctx.lineWidth = 1;
	ctx.fill(TRANSPORT_HULL);
	ctx.stroke(TRANSPORT_HULL);
	if (zoom >= 1.75) {
		ctx.fillStyle = UNIT_SHADE[owner];
		ctx.fillRect(-5.5, -8.5, 6, 5.5);
		ctx.fillRect(-5.5, 3, 6, 5.5);
		ctx.strokeStyle = UNIT_HIGHLIGHT[owner];
		ctx.lineWidth = 0.7;
		ctx.beginPath();
		ctx.moveTo(-7.5, -8.5);
		ctx.lineTo(1, -8.5);
		ctx.moveTo(-7.5, 8.5);
		ctx.lineTo(1, 8.5);
		ctx.stroke();
	}
	if (zoom >= 2.5) {
		ctx.fillStyle = UNIT_HIGHLIGHT[owner];
		for (const x of [-5, -3.5, -2]) {
			ctx.fillRect(x, -8, 0.75, 2.4);
			ctx.fillRect(x, 5.6, 0.75, 2.4);
		}
		ctx.fillStyle = UNIT_SHADE[owner];
		ctx.fillRect(4.5, -1.2, 2, 2.4);
		ctx.fillRect(3.8, -0.5, 3.4, 1);
	}
	if (zoom >= 3.5) {
		ctx.save();
		ctx.rotate(-angle);
		const radius = 8 / scale;
		ctx.fillStyle = '#10202b';
		ctx.beginPath();
		ctx.arc(0, 0, radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = COLORS[owner];
		ctx.lineWidth = 1 / scale;
		ctx.stroke();
		ctx.fillStyle = UNIT_HIGHLIGHT[owner];
		ctx.font = `bold ${10 / scale}px ui-monospace, monospace`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(String(cargo), 0, 0);
		ctx.restore();
	}
};
const timeLabel = function (seconds: number): string {
	return `${Math.floor(seconds / 60)
		.toString()
		.padStart(2, '0')}:${Math.floor(seconds % 60)
		.toString()
		.padStart(2, '0')}`;
};
const feedback = function (text: string): void {
	orderMessage = text;
	noticeUntil = performance.now() + 2600;
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
	saveStatus.textContent = message;
	menuSaveStatus.textContent = message;
};
const savedStatus = function (savedAt: number): string {
	return `Saved ${new Date(savedAt).toLocaleString()}`;
};
const sameMap = function (left: StarMap, right: StarMap): boolean {
	return (
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
	const save = captureConquestSave(
		world,
		activeMap,
		scenario,
		speed,
		profileId,
	);
	updateSaveStatus('Saving…');
	try {
		await profileRepository.saveProfile(save);
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
		if (busy) return;
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
	cancelGesture();
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
const selectPlanet = function (id: number): void {
	if (
		busy ||
		frontMenu.getCurrentScreen() !== 'playing' ||
		world.getResource('match').winner
	)
		return;
	const p = world.getComponent(id, 'planet');
	if (!p) return;
	const selectable =
		p.owner === 'blue' || shipsAt(world, id, 'blue').length > 0;
	if (selected.includes(id)) {
		selected = selected.filter(function (value) {
			return value !== id;
		});
		inspected = undefined;
	} else if (multi) {
		if (selectable) selected = [...selected, id];
		else feedback('Finish source selection before choosing a destination.');
	} else {
		selected = selectable ? [id] : [];
		inspected = p.owner === 'blue' ? undefined : id;
	}
	refresh();
};
const sendToPlanet = function (id: number): void {
	if (
		busy ||
		frontMenu.getCurrentScreen() !== 'playing' ||
		world.getResource('match').winner
	)
		return;
	const p = world.getComponent(id, 'planet');
	if (!p) return;
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
		feedback(
			sent > 0
				? `${sent} ${sent === 1 ? 'unit' : 'units'} launched → ${p.name}`
				: 'No units launched. Check stock, filter, or blockade.',
		);
		if (sent > 0) queueAutosave();
	}
	refresh();
};
const mountPlanets = function (): void {
	planetLayer.replaceChildren();
	views.clear();
	for (const {
		id,
		components: { planet: p },
	} of planets(world)) {
		const button = document.createElement('button');
		button.className = 'planet';
		button.dataset.planet = p.name;
		button.style.left = `${p.x}px`;
		button.style.top = `${p.y}px`;
		button.innerHTML =
			'<span class="surface"></span><span class="count"></span><span class="name"></span><span class="orbit-count"></span><span class="production-mark"></span><span class="production-progress"><i></i></span>';
		const count = button.querySelector('.count');
		const name = button.querySelector('.name');
		const orbit = button.querySelector('.orbit-count');
		const mark = button.querySelector('.production-mark');
		const progress = button.querySelector('i');
		if (
			!(count instanceof HTMLSpanElement) ||
			!(name instanceof HTMLSpanElement) ||
			!(orbit instanceof HTMLSpanElement) ||
			!(mark instanceof HTMLSpanElement) ||
			!(progress instanceof HTMLElement)
		)
			throw new Error('Planet template incomplete');
		name.textContent = p.name;
		button.addEventListener('pointerdown', function (event) {
			if (event.pointerType === 'mouse' && event.button === 2) {
				event.preventDefault();
				sendToPlanet(id);
			}
		});
		button.addEventListener('click', function () {
			selectPlanet(id);
		});
		planetLayer.append(button);
		views.set(id, { button, count, orbit, mark, progress });
	}
};
const refresh = function (): void {
	const match = world.getResource('match');
	const all = planets(world);
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
	for (const {
		id,
		components: { planet: p },
	} of all) {
		const view = views.get(id);
		if (!view) continue;
		const blue = shipsAt(world, id, 'blue').length;
		const red = shipsAt(world, id, 'red').length;
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
			`${p.name}, ${p.owner === 'blue' ? 'your' : p.owner === 'red' ? 'rival' : 'neutral'} planet, ${p.troops} troops, ${blue} your ships, ${red} rival ships, ${guns} defense platforms${blocked ? ', blockaded' : ''}`,
		);
		view.count.textContent = String(p.troops);
		view.orbit.replaceChildren();
		for (const [side, count] of [
			['blue', blue],
			['red', red],
		] as const) {
			if (count === 0) continue;
			const span = document.createElement('span');
			span.style.color = COLORS[side];
			span.textContent = `◆${count} `;
			view.orbit.append(span);
		}
		if (guns > 0) view.orbit.append(`✣${guns}`);
		view.mark.textContent = p.owner === 'neutral' ? '' : icons[p.production];
		view.progress.style.width = `${(p.progress / CONFIG.cost[p.production]) * 100}%`;
	}
	planetPanel.hidden = selected.length === 0 && inspected === undefined;
	dispatchControls.hidden = selected.length === 0;
	const ownedSelected = selected.flatMap(function (id) {
		const p = world.getComponent(id, 'planet');
		return p?.owner === 'blue' ? [p] : [];
	});
	productionControls.hidden = ownedSelected.length === 0;
	const shipsOnly = selected.length > 0 && ownedSelected.length === 0;
	dispatchFilterControls.hidden = shipsOnly;
	dispatchInfo.textContent = shipsOnly
		? 'orbiting ships only'
		: 'defense platforms stay behind';
	const first = selected[0] ?? inspected;
	const p =
		first === undefined ? undefined : world.getComponent(first, 'planet');
	selectionName.textContent =
		selected.length > 1
			? `${selected.length} sources selected`
			: p
				? p.name
				: 'No source selected';
	selectionInfo.textContent =
		selected.length === 0 || (selected.length === 1 && p?.owner !== 'blue')
			? p
				? `${p.owner === 'blue' ? 'Your' : p.owner === 'red' ? 'Rival' : 'Neutral'} world · ${p.troops} troops · ${first === undefined ? 0 : shipsAt(world, first, 'red').length} rival ships · ${Math.ceil(p.guns)} defense platforms`
				: 'Tap or left-click a blue planet to select.'
			: `${ownedSelected.reduce(function (sum, p) {
					return sum + p.troops;
				}, 0)} troops · ${selected.reduce(function (sum, id) {
					return sum + shipsAt(world, id, 'blue').length;
				}, 0)} ships · ${Math.ceil(
					ownedSelected.reduce(function (sum, p) {
						return sum + p.guns;
					}, 0),
				)} defense platforms${p && p.owner !== 'blue' ? ' · orbit only' : ''}`;
	orbitalInfo.hidden = !(selected.length === 1 && shipsOnly);
	orbitalInfo.textContent =
		first === undefined
			? ''
			: `${shipsAt(world, first, 'blue').length} your orbiting ships · hold or right-click a destination to send`;
	productionInfo.textContent =
		p && p.owner === 'blue' && selected.length === 1
			? `${(p.rate * CONFIG.productionRateMultiplier).toFixed(1)} work / sec`
			: 'on selected worlds';
	for (const button of productionButtons) {
		button.disabled = ownedSelected.length === 0 || Boolean(match.winner);
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
	instruction.textContent = multi
		? 'Tap or left-click sources · finish selection to send'
		: selected.length
			? 'Hold or right-click a destination to send'
			: 'Select a blue planet or orbital ring';
	multiButton.setAttribute('aria-pressed', String(multi));
	multiButton.textContent = multi ? '✓ Finish selection' : '＋ Multi-select';
	blueCount.textContent = String(
		all.filter(function (e) {
			return e.components.planet.owner === 'blue';
		}).length,
	);
	redCount.textContent = String(
		all.filter(function (e) {
			return e.components.planet.owner === 'red';
		}).length,
	);
	clock.textContent = timeLabel(match.time);
	pause.textContent = match.paused ? '▷' : 'Ⅱ';
	pause.setAttribute('aria-label', match.paused ? 'Resume game' : 'Pause game');
	pause.setAttribute('aria-pressed', String(match.paused));
	pause.title = match.paused
		? 'Resume game'
		: 'Pause action to issue orders and change production';
	const result = match.winner
		? match.winner === 'blue'
			? 'All rival worlds captured. You win. Restart to play again.'
			: 'Your last world has fallen. Restart to try again.'
		: '';
	banner.textContent =
		result ||
		(performance.now() < noticeUntil
			? orderMessage
			: match.paused
				? 'Paused · commands remain available'
				: '');
	banner.style.display = banner.textContent ? 'block' : 'none';
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
				row.textContent = `${timeLabel(n.time)} ${n.text}`;
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

const draw = function (): void {
	const { width, height } = activeMap;
	const dpr = Math.min((devicePixelRatio || 1) * Math.max(1, camera.scale), 3);
	if (
		canvas.width !== Math.round(width * dpr) ||
		canvas.height !== Math.round(height * dpr)
	) {
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
	}
	ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
	ctx.clearRect(0, 0, width, height);
	for (let i = 0; i < 460; i++) {
		ctx.fillStyle = i % 4 === 0 ? '#738ea45c' : '#42627b55';
		ctx.fillRect(
			(i * 137.57) % width,
			(i * 83.37) % height,
			i % 5 === 0 ? 1.8 : 1,
			i % 5 === 0 ? 1.8 : 1,
		);
	}
	const match = world.getResource('match');
	const zoom = camera.scale / fitScale;
	const all = planets(world);
	for (const {
		id,
		components: { planet: p },
	} of all) {
		ctx.strokeStyle = '#4d739517';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(p.x, p.y, p.radius + 20, 0, Math.PI * 2);
		ctx.stroke();
		const blue = shipsAt(world, id, 'blue').length;
		const red = shipsAt(world, id, 'red').length;
		if ((blue > 0 && p.owner !== 'blue') || (red > 0 && p.owner !== 'red')) {
			ctx.strokeStyle =
				blue > 0 && p.owner !== 'blue' ? COLORS.blue : COLORS.red;
			ctx.lineWidth = isBlockaded(world, id) ? 2 : 1;
			ctx.setLineDash(isBlockaded(world, id) ? [6, 6] : []);
			ctx.lineDashOffset = -match.time * 10;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.radius + 17, 0, Math.PI * 2);
			ctx.stroke();
			ctx.setLineDash([]);
		}
		const hasBlue = blue > 0 || (p.owner === 'blue' && p.guns > 0);
		const hasRed = red > 0 || (p.owner === 'red' && p.guns > 0);
		if (hasBlue && hasRed) {
			const angle = match.time * 4;
			ctx.strokeStyle = '#ffe3a9';
			ctx.lineWidth = 1.7;
			ctx.beginPath();
			ctx.moveTo(
				p.x + Math.cos(angle) * (p.radius + 19),
				p.y + Math.sin(angle) * (p.radius + 19),
			);
			ctx.lineTo(
				p.x - Math.cos(angle) * (p.radius + 19),
				p.y - Math.sin(angle) * (p.radius + 19),
			);
			ctx.stroke();
		}
	}
	const highlighted = drawer.highlighted();
	if (highlighted) {
		ctx.save();
		ctx.strokeStyle = COLORS.blue;
		ctx.lineWidth = 2 / camera.scale;
		ctx.setLineDash(
			highlighted.state === 'pending'
				? [8 / camera.scale, 5 / camera.scale]
				: [],
		);
		for (const entity of orderUnits(world, highlighted)) {
			const u = entity.components.unit;
			const target = world.getComponent(u.target, 'planet');
			if (!target) continue;
			const point = unitPoint(u, target, match.time, entity.id);
			ctx.beginPath();
			ctx.moveTo(point.x, point.y);
			ctx.lineTo(target.x, target.y);
			ctx.stroke();
		}
		ctx.restore();
	}

	for (const {
		id,
		components: { unit: u },
	} of units(world)) {
		if (u.hp <= 0) continue;
		const p = world.getComponent(u.target, 'planet');
		if (!p) continue;
		const { x, y, angle } = unitPoint(u, p, match.time, id);
		if (u.phase === 'travel') {
			ctx.strokeStyle = `${COLORS[u.owner]}22`;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(p.x, p.y);
			ctx.stroke();
		}
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(angle);
		if (u.kind === 'ship') {
			drawWarship(u.owner, zoom);
		} else {
			drawTroopTransport(u.owner, u.cargo, zoom, camera.scale, angle);
		}
		ctx.restore();
	}
	for (const shot of match.engagements) {
		ctx.save();
		ctx.strokeStyle = COLORS[shot.owner];
		ctx.lineCap = 'round';
		ctx.globalAlpha = 0.35;
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(shot.x1, shot.y1);
		ctx.lineTo(shot.x2, shot.y2);
		ctx.stroke();
		ctx.globalAlpha = 0.95;
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.restore();
	}
};

// The simulation and both render layers share one world-space transform.
let camera: Camera = { x: 0, y: 0, scale: 1 };
let fitScale = 1;
const applyCamera = function (): void {
	mapWorld.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
};
const fitMap = function (): void {
	const width = board.clientWidth;
	const height = board.clientHeight;
	if (width === 0 || height === 0) return;
	const top = width < 700 ? 200 : 130;
	const bottom = 85;
	fitScale = Math.max(
		0.1,
		Math.min(
			(width - 48) / activeMap.width,
			(height - top - bottom) / activeMap.height,
		),
	);
	camera = {
		x: (width - activeMap.width * fitScale) / 2,
		y: top + (height - top - bottom - activeMap.height * fitScale) / 2,
		scale: fitScale,
	};
	applyCamera();
};
const zoomAt = function (anchor: Point, factor: number): void {
	camera = zoomCamera(camera, anchor, factor, fitScale * 0.5, fitScale * 5);
	applyCamera();
};
const localPoint = function (event: PointerEvent): Point {
	const rect = board.getBoundingClientRect();
	return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};
const pointers = new Map<number, Point>();
let gestureMoved = false;
let holdHandled = false;
let holdTimer: ReturnType<typeof setTimeout> | undefined;
const cancelHold = function (): void {
	clearTimeout(holdTimer);
	holdTimer = undefined;
};
let gestureStart: Point | undefined;
const midpoint = function (a: Point, b: Point): Point {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};
board.addEventListener('pointerdown', function (event) {
	if (event.button !== 0) return;
	if (pointers.size === 0) {
		gestureMoved = false;
		holdHandled = false;
		gestureStart = localPoint(event);
	}
	pointers.set(event.pointerId, localPoint(event));
	if (pointers.size > 1) {
		gestureMoved = true;
		cancelHold();
	} else if (event.pointerType === 'touch' || event.pointerType === 'pen') {
		const target =
			event.target instanceof Element
				? event.target.closest('button.planet')
				: null;
		const id = [...views].find(function ([, view]) {
			return view.button === target;
		})?.[0];
		if (id !== undefined) {
			holdTimer = setTimeout(function () {
				holdTimer = undefined;
				holdHandled = true;
				sendToPlanet(id);
			}, 500);
		}
	}
});
board.addEventListener('pointermove', function (event) {
	const previous = pointers.get(event.pointerId);
	if (!previous) return;
	const current = localPoint(event);
	if (
		gestureStart &&
		Math.hypot(current.x - gestureStart.x, current.y - gestureStart.y) > 6
	)
		gestureMoved = true;
	if (gestureMoved) {
		cancelHold();
		board.setPointerCapture(event.pointerId);
		const other = [...pointers.entries()].find(function ([id]) {
			return id !== event.pointerId;
		})?.[1];
		if (other) {
			const before = midpoint(previous, other);
			const after = midpoint(current, other);
			const distance = Math.hypot(previous.x - other.x, previous.y - other.y);
			if (distance > 0)
				zoomAt(
					before,
					Math.hypot(current.x - other.x, current.y - other.y) / distance,
				);
			camera = {
				...camera,
				x: camera.x + after.x - before.x,
				y: camera.y + after.y - before.y,
			};
		} else
			camera = {
				...camera,
				x: camera.x + current.x - previous.x,
				y: camera.y + current.y - previous.y,
			};
		applyCamera();
		board.classList.add('dragging');
	}
	pointers.set(event.pointerId, current);
});
const endPointer = function (event: PointerEvent): void {
	if (!pointers.has(event.pointerId)) return;
	cancelHold();
	if (event.type !== 'pointerup') gestureMoved = true;
	pointers.delete(event.pointerId);
	if (pointers.size === 0) board.classList.remove('dragging');
};
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
board.addEventListener('lostpointercapture', function (event) {
	if (event.target === board && !board.hasPointerCapture(event.pointerId))
		endPointer(event);
});
board.addEventListener(
	'click',
	function (event) {
		if ((gestureMoved || holdHandled) && event.detail !== 0) {
			event.stopImmediatePropagation();
			event.preventDefault();
		}
	},
	true,
);
board.addEventListener('contextmenu', function (event) {
	event.preventDefault();
});
const cancelGesture = function (): void {
	cancelHold();
	pointers.clear();
	gestureMoved = true;
	board.classList.remove('dragging');
};
window.addEventListener('blur', cancelGesture);
board.addEventListener(
	'wheel',
	function (event) {
		event.preventDefault();
		const multiplier =
			event.deltaMode === 1
				? 16
				: event.deltaMode === 2
					? board.clientHeight
					: 1;
		if (event.deltaY !== 0) {
			const rect = board.getBoundingClientRect();
			const sensitivity = event.ctrlKey || event.metaKey ? 0.01 : 0.002;
			zoomAt(
				{ x: event.clientX - rect.left, y: event.clientY - rect.top },
				Math.exp(-event.deltaY * multiplier * sensitivity),
			);
		} else {
			camera = {
				...camera,
				x: camera.x - event.deltaX * multiplier,
			};
			applyCamera();
		}
	},
	{ passive: false },
);
board.addEventListener('keydown', function (event) {
	const deltas: Record<string, Point> = {
		ArrowLeft: { x: 50, y: 0 },
		ArrowRight: { x: -50, y: 0 },
		ArrowUp: { x: 0, y: 50 },
		ArrowDown: { x: 0, y: -50 },
	};
	const delta = deltas[event.key];
	if (!delta) return;
	event.preventDefault();
	camera = { ...camera, x: camera.x + delta.x, y: camera.y + delta.y };
	applyCamera();
});
const resizeObserver = new ResizeObserver(fitMap);
resizeObserver.observe(board);
const fieldGuide = element('field-guide', HTMLElement);
const settings = element('settings', HTMLButtonElement);
const toggleGuide = function (): void {
	if (fieldGuide.hidden && !ordersPanel.hidden) drawer.close();
	fieldGuide.hidden = !fieldGuide.hidden;
	settings.setAttribute('aria-expanded', String(!fieldGuide.hidden));
	settings.setAttribute(
		'aria-label',
		fieldGuide.hidden ? 'Open game menu' : 'Close game menu',
	);
	if (fieldGuide.hidden) settings.focus();
	else element('close-guide', HTMLButtonElement).focus();
};
settings.addEventListener('click', toggleGuide);
element('close-guide', HTMLButtonElement).addEventListener(
	'click',
	toggleGuide,
);

const fullscreen = element('fullscreen', HTMLButtonElement);
const syncFullscreen = function (): void {
	const active = Boolean(document.fullscreenElement);
	const label = active ? 'Exit fullscreen' : 'Enter fullscreen';
	fullscreen.setAttribute('aria-pressed', String(active));
	fullscreen.setAttribute('aria-label', label);
	fullscreen.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
	fullscreen.disabled = !document.fullscreenEnabled;
	fullscreen.title = document.fullscreenEnabled
		? label
		: 'Fullscreen unavailable in this browser';
};
fullscreen.addEventListener('click', async function () {
	fullscreen.disabled = true;
	try {
		if (document.fullscreenElement) await document.exitFullscreen();
		else await document.documentElement.requestFullscreen();
	} catch {
		feedback('Fullscreen could not open. Check browser permissions.');
		refresh();
	} finally {
		syncFullscreen();
	}
});
document.addEventListener('fullscreenchange', syncFullscreen);
syncFullscreen();

const installGame = async function (
	installation: GameInstallation,
): Promise<void> {
	if (disposed) {
		await installation.game.dispose();
		return;
	}
	const previousWorld = world;
	world = installation.game;
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
		selected = [];
		inspected = undefined;
		multi = false;
		drawer.reset();
		noticeUntil = 0;
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
): Promise<void> {
	if (busy) return;
	busy = true;
	app.inert = true;
	if (queuedAutosave !== undefined) {
		window.clearTimeout(queuedAutosave);
		queuedAutosave = undefined;
	}
	cancelGesture();
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
				!window.confirm(
					`Restarting will replace ${profile.name}'s active conquest with a new one. Continue?`,
				)
			) {
				scenarioSelect.value = activeMap === LAB_MAP ? scenario : 'generated';
				return;
			}
		}
		replacement = await createGame(next, map);
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
	});
for (const button of filterButtons)
	button.addEventListener('click', function () {
		const value = button.dataset.filter;
		if (value !== 'combined' && value !== 'ships' && value !== 'troops') return;
		filter = value;
		for (const item of filterButtons)
			item.setAttribute('aria-pressed', String(item === button));
	});
multiButton.addEventListener('click', function () {
	multi = !multi;
	refresh();
});
element('clear', HTMLButtonElement).addEventListener('click', function () {
	selected = [];
	inspected = undefined;
	multi = false;
	refresh();
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
const frame = function (now: number): void {
	if (disposed) return;
	const dt = Math.min(Math.max((now - previous) / 1000, 0), 0.1);
	previous = now;
	if (!busy && frontMenu.getCurrentScreen() === 'playing') {
		// Keep rendering and command input live while simulation time is frozen.
		if (!world.getResource('match').paused) world.update(dt * speed);
		draw();
		if (now - lastRefresh > 100) {
			refresh();
			lastRefresh = now;
		}
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
	start: async function (map) {
		await restart('skirmish', map, true);
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
		cancelGesture();
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

const autosaveTimer = window.setInterval(function () {
	if (busy || frontMenu.getCurrentScreen() !== 'playing') return;
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
	if (frontMenu.getCurrentScreen() !== 'playing') return;
	if (document.hidden) {
		cancelGesture();
		hiddenPause = !world.getResource('match').paused;
		world.getResource('match').paused = true;
	} else if (hiddenPause) {
		world.getResource('match').paused = false;
		hiddenPause = false;
	}
});
window.addEventListener('keydown', function (event) {
	if (frontMenu.getCurrentScreen() !== 'playing' || busy) return;
	if (event.key === 'Escape') {
		if (!ordersPanel.hidden) {
			drawer.close();
			return;
		}
		if (!fieldGuide.hidden) toggleGuide();
		selected = [];
		inspected = undefined;
		multi = false;
		refresh();
	}
	if (event.code === 'Space' && event.target === document.body) {
		event.preventDefault();
		pause.click();
	}
});
raf = requestAnimationFrame(frame);
window.addEventListener('pagehide', function (event) {
	if (event.persisted) return;
	disposed = true;
	cancelGesture();
	cancelAnimationFrame(raf);
	if (autosaveTimer !== undefined) window.clearInterval(autosaveTimer);
	if (queuedAutosave !== undefined) window.clearTimeout(queuedAutosave);
	resizeObserver.disconnect();
	void world.dispose();
	void frontMenu.dispose();
	profileRepository?.close();
});
