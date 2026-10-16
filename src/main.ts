import { createOrdersDrawer } from './orders-drawer';
import { zoomCamera } from './camera';
import type { Camera, Point } from './camera';
import { CONFIG, COLORS, MAP } from './config';
import type { DispatchFilter, Production, Scenario, Side } from './config';
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

const element = function <T extends HTMLElement>(
	id: string,
	constructor: { new (...args: never[]): T },
): T {
	const found = document.getElementById(id);
	if (!(found instanceof constructor)) throw new Error(`Missing ${id}`);
	return found;
};
const board = element('board', HTMLElement);
const mapWorld = element('map-world', HTMLDivElement);
mapWorld.style.width = `${MAP.width}px`;
mapWorld.style.height = `${MAP.height}px`;
const planetPanel = element('planet-panel', HTMLElement);
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
const welcome = element('welcome', HTMLDialogElement);
const pause = element('pause', HTMLButtonElement);
const scenarioSelect = element('scenario', HTMLSelectElement);
const aiInput = element('ai', HTMLInputElement);
const speedSelect = element('speed', HTMLSelectElement);
const instruction = element('instruction', HTMLSpanElement);
const selectionName = element('selection-name', HTMLHeadingElement);
const selectionInfo = element('selection-info', HTMLParagraphElement);
const orbitalInfo = element('orbital-info', HTMLParagraphElement);
const productionInfo = element('production-info', HTMLSpanElement);
const productionControls = element('production-controls', HTMLDetailsElement);
const banner = element('banner', HTMLDivElement);
const events = element('events', HTMLDivElement);
const metrics = element('metrics', HTMLDivElement);
const blueCount = element('blue-count', HTMLElement);
const redCount = element('red-count', HTMLElement);
const clock = element('clock', HTMLDivElement);
const multiButton = element('multi', HTMLButtonElement);
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
const views = new Map<number, PlanetView>();
let world: Game = await createGame();
let selected: number[] = [];
let inspected: number | undefined;
let fraction = 0.5;
let filter: DispatchFilter = 'combined';
let multi = false;
let scenario: Scenario = 'skirmish';
let speed = 1;
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
const selectPlanet = function (id: number): void {
	if (busy || welcome.open || world.getResource('match').winner) return;
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
	revealSelection(id);
};
const sendToPlanet = function (id: number): void {
	if (busy || welcome.open || world.getResource('match').winner) return;
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
		const hitSize = Math.max(Math.min(44 / camera.scale, 180), (p.radius + 32) * 2);
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
	productionControls.hidden = ownedSelected.length === 0;
	productionInfo.textContent =
		p && p.owner === 'blue' && selected.length === 1
			? `${icons[p.production]} ${p.production === 'guns' ? 'Defense Platform' : p.production === 'ships' ? 'Ships' : 'Troops'}`
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
	pause.textContent = match.paused ? '▷ Resume' : 'Ⅱ Pause';
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
			: match.paused && !welcome.open
				? 'Paused · issue orders and change production · resume to continue'
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
		settings.setAttribute('aria-label', 'Open field guide');
	},
	function (message) {
		feedback(message);
		refresh();
	},
);

const draw = function (): void {
	const { width, height } = MAP;
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
	mapWorld.style.setProperty('--map-scale', String(camera.scale));
	mapWorld.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
};
const fitMap = function (): void {
	const width = board.clientWidth;
	const height = board.clientHeight;
	const top = width < 700 ? 200 : 130;
	const bottom = 85;
	fitScale = Math.max(
		0.1,
		Math.min((width - 48) / MAP.width, (height - top - bottom) / MAP.height),
	);
	camera = {
		x: (width - MAP.width * fitScale) / 2,
		y: top + (height - top - bottom - MAP.height * fitScale) / 2,
		scale: fitScale,
	};
	applyCamera();
};
// Shift only when the newly opened command panel covers the inspected world.
const revealSelection = function (id: number): void {
	if (planetPanel.hidden || !ordersPanel.hidden || !fieldGuide.hidden) return;
	const p = world.getComponent(id, 'planet');
	if (!p) return;
	const panel = planetPanel.getBoundingClientRect();
	const x = camera.x + p.x * camera.scale;
	const y = camera.y + p.y * camera.scale;
	if (
		x < panel.left - 30 || x > panel.right + 30 ||
		y < panel.top - 30 || y > panel.bottom + 30
	) return;
	const heading = document.querySelector('.map-heading');
	const top = Math.max(
		heading?.getBoundingClientRect().bottom ?? 190,
		board.clientWidth < 700 ? banner.getBoundingClientRect().bottom : 0,
	);
	if (board.clientWidth < 700) {
		if (panel.top - top < 50) return;
		camera = { ...camera, y: camera.y + (top + panel.top) / 2 - y };
	} else {
		camera = {
			...camera,
			x: camera.x + (panel.left + 20) / 2 - x,
			y: camera.y + Math.min(board.clientHeight - 50, Math.max(y, top + 50)) - y,
		};
	}
	applyCamera();
};
const zoomAt = function (anchor: Point, factor: number): void {
	camera = zoomCamera(camera, anchor, factor, fitScale * 0.5, fitScale * 5);
	applyCamera();
};
element('zoom-in', HTMLButtonElement).addEventListener('click', function () {
	zoomAt({ x: board.clientWidth / 2, y: board.clientHeight / 2 }, 1.3);
});
element('zoom-out', HTMLButtonElement).addEventListener('click', function () {
	zoomAt({ x: board.clientWidth / 2, y: board.clientHeight / 2 }, 1 / 1.3);
});
element('fit-map', HTMLButtonElement).addEventListener('click', fitMap);
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
		fieldGuide.hidden ? 'Open field guide' : 'Close field guide',
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
	fullscreen.textContent = active ? '⊡' : '⛶';
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

const restart = async function (next: Scenario = scenario): Promise<void> {
	if (busy) return;
	busy = true;
	cancelGesture();
	try {
		const replacement = await createGame(next);
		await world.dispose();
		world = replacement;
		scenario = next;
		selected = [];
		inspected = undefined;
		multi = false;
		drawer.reset();
		noticeUntil = 0;
		lastNoticeKey = '';
		fitMap();
		mountPlanets();
		refresh();
	} finally {
		busy = false;
	}
};
for (const button of productionButtons)
	button.addEventListener('click', function () {
		const value = button.dataset.production;
		if (value === 'troops' || value === 'ships' || value === 'guns')
			setProduction(world, selected, value);
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
	refresh();
});
element('restart', HTMLButtonElement).addEventListener('click', function () {
	void restart();
});
scenarioSelect.addEventListener('change', function () {
	const next = scenarioSelect.value;
	if (next === 'skirmish' || next === 'blockade' || next === 'invasion')
		void restart(next);
});
speedSelect.addEventListener('change', function () {
	speed = Number(speedSelect.value);
});
aiInput.addEventListener('change', function () {
	world.getResource('match').ai = aiInput.checked;
});
element('start', HTMLButtonElement).addEventListener('click', function () {
	welcome.close();
	world.getResource('match').paused = false;
	refresh();
});
welcome.addEventListener('cancel', function () {
	world.getResource('match').paused = false;
});
document.addEventListener('visibilitychange', function () {
	if (document.hidden) {
		cancelGesture();
		hiddenPause = !world.getResource('match').paused;
		world.getResource('match').paused = true;
	} else if (hiddenPause && !welcome.open) {
		world.getResource('match').paused = false;
		hiddenPause = false;
	}
});
window.addEventListener('keydown', function (event) {
	if (event.key === 'Escape' && !welcome.open) {
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
	if (
		event.code === 'Space' &&
		event.target === document.body &&
		!welcome.open
	) {
		event.preventDefault();
		pause.click();
	}
});
let previous = performance.now();
let lastRefresh = 0;
const frame = function (now: number): void {
	if (disposed) return;
	const dt = Math.min(Math.max((now - previous) / 1000, 0), 0.1);
	previous = now;
	if (!busy) {
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
fitMap();
mountPlanets();
refresh();
welcome.showModal();
raf = requestAnimationFrame(frame);
window.addEventListener('pagehide', function (event) {
	if (event.persisted) return;
	disposed = true;
	cancelGesture();
	cancelAnimationFrame(raf);
	resizeObserver.disconnect();
	void world.dispose();
});
