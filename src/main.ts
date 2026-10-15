import { CONFIG, COLORS } from './config';
import type { DispatchFilter, Production, Scenario } from './config';
import {
	createGame,
	dispatch,
	isBlockaded,
	planets,
	setProduction,
	shipsAt,
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
const board = element('board', HTMLDivElement);
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
const productionInfo = element('production-info', HTMLSpanElement);
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
const timeLabel = function (seconds: number) {
	return `${Math.floor(seconds / 60)
		.toString()
		.padStart(2, '0')}:${Math.floor(seconds % 60)
		.toString()
		.padStart(2, '0')}`;
};
const feedback = function (text: string) {
	orderMessage = text;
	noticeUntil = performance.now() + 2600;
};
const selectPlanet = function (id: number) {
	if (busy || welcome.open || world.getResource('match').winner) return;
	const p = world.getComponent(id, 'planet');
	if (!p) return;
	const selectable =
		p.owner === 'blue' || shipsAt(world, id, 'blue').length > 0;
	if (selected.includes(id))
		selected = selected.filter(function (value) {
			return value !== id;
		});
	else if (multi) {
		if (selectable) selected = [...selected, id];
		else feedback('Finish source selection before choosing a destination.');
	} else if (selected.length > 0) {
		const sent = dispatch(world, selected, id, fraction, filter);
		feedback(
			sent > 0
				? `${sent} ${sent === 1 ? 'unit' : 'units'} launched → ${p.name}`
				: 'No units launched. Check stock, filter, or blockade.',
		);
	} else if (selectable) selected = [id];
	else feedback('Select a blue surface or a blue orbital presence first.');
	refresh();
};
const mountPlanets = function () {
	planetLayer.replaceChildren();
	views.clear();
	for (const {
		id,
		components: { planet: p },
	} of planets(world)) {
		const button = document.createElement('button');
		button.className = 'planet';
		button.dataset.planet = p.name;
		button.style.left = `${p.x / 6}%`;
		button.style.top = `${p.y / 6.6}%`;
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
		button.addEventListener('click', function () {
			selectPlanet(id);
		});
		planetLayer.append(button);
		views.set(id, { button, count, orbit, mark, progress });
	}
};
const refresh = function () {
	const match = world.getResource('match');
	const all = planets(world);
	selected = selected.filter(function (id) {
		return (
			world.getComponent(id, 'planet')?.owner === 'blue' ||
			shipsAt(world, id, 'blue').length > 0
		);
	});
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
		const hitSize = Math.max(
			54,
			(((p.radius + 32) * 2) / 600) * board.clientWidth,
		);
		view.button.style.width = `${hitSize}px`;
		view.button.style.height = `${hitSize}px`;
		view.button.style.setProperty('--owner', COLORS[p.owner]);
		view.button.style.setProperty(
			'--diameter',
			`${((p.radius * 2) / 600) * board.clientWidth}px`,
		);
		view.button.classList.toggle('selected', selected.includes(id));
		view.button.setAttribute('aria-pressed', String(selected.includes(id)));
		view.button.setAttribute(
			'aria-label',
			`${p.name}, ${p.owner === 'blue' ? 'your' : p.owner === 'red' ? 'rival' : 'neutral'} planet, ${p.troops} troops, ${blue} your ships, ${red} rival ships, ${guns} guns${blocked ? ', blockaded' : ''}`,
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
	const ownedSelected = selected.flatMap(function (id) {
		const p = world.getComponent(id, 'planet');
		return p?.owner === 'blue' ? [p] : [];
	});
	const first = selected[0];
	const p =
		first === undefined ? undefined : world.getComponent(first, 'planet');
	selectionName.textContent =
		selected.length > 1
			? `${selected.length} sources selected`
			: p
				? p.name
				: 'No source selected';
	selectionInfo.textContent =
		selected.length === 0
			? 'Tap a blue planet, then a destination.'
			: `${ownedSelected.reduce(function (sum, p) {
					return sum + p.troops;
				}, 0)} troops · ${selected.reduce(function (sum, id) {
					return sum + shipsAt(world, id, 'blue').length;
				}, 0)} ships · ${Math.ceil(
					ownedSelected.reduce(function (sum, p) {
						return sum + p.guns;
					}, 0),
				)} guns${p && p.owner !== 'blue' ? ' · orbit only' : ''}`;
	productionInfo.textContent =
		p && p.owner === 'blue' && selected.length === 1
			? `${p.rate.toFixed(1)} work / sec`
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
		? 'Tap sources to add · turn off to send'
		: selected.length
			? 'Tap a destination to send'
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
				? 'Paused · change orders or resume when ready'
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
};

const draw = function () {
	const width = board.clientWidth,
		height = board.clientHeight;
	const dpr = Math.min(devicePixelRatio || 1, 2);
	if (
		canvas.width !== Math.round(width * dpr) ||
		canvas.height !== Math.round(height * dpr)
	) {
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
	}
	ctx.setTransform(canvas.width / 600, 0, 0, canvas.height / 660, 0, 0);
	ctx.clearRect(0, 0, 600, 660);
	for (let i = 0; i < 115; i++) {
		ctx.fillStyle = i % 4 === 0 ? '#738ea45c' : '#42627b55';
		ctx.fillRect(
			(i * 137.57) % 600,
			(i * 83.37) % 660,
			i % 5 === 0 ? 1.8 : 1,
			i % 5 === 0 ? 1.8 : 1,
		);
	}
	const match = world.getResource('match');
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
	for (const {
		id,
		components: { unit: u },
	} of units(world)) {
		if (u.hp <= 0) continue;
		const p = world.getComponent(u.target, 'planet');
		if (!p) continue;
		const orbitAngle =
			match.time * (u.owner === 'blue' ? 0.45 : -0.45) + id * 2.399;
		const radius = p.radius + (u.kind === 'ship' ? 20 : 32);
		const x = u.phase === 'orbit' ? p.x + Math.cos(orbitAngle) * radius : u.x;
		const y = u.phase === 'orbit' ? p.y + Math.sin(orbitAngle) * radius : u.y;
		const angle =
			u.phase === 'orbit'
				? orbitAngle + Math.PI / 2
				: Math.atan2(p.y - u.y, p.x - u.x);
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
		ctx.fillStyle = COLORS[u.owner];
		if (u.kind === 'ship') {
			ctx.beginPath();
			ctx.moveTo(6, 0);
			ctx.lineTo(-4, -3);
			ctx.lineTo(-2, 0);
			ctx.lineTo(-4, 3);
			ctx.closePath();
			ctx.fill();
		} else {
			ctx.strokeStyle = COLORS[u.owner];
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.moveTo(4, 0);
			ctx.lineTo(-3, -3);
			ctx.lineTo(-3, 3);
			ctx.closePath();
			ctx.stroke();
		}
		ctx.restore();
	}
};

const restart = async function (next: Scenario = scenario) {
	if (busy) return;
	busy = true;
	try {
		const replacement = await createGame(next);
		await world.dispose();
		world = replacement;
		scenario = next;
		selected = [];
		multi = false;
		noticeUntil = 0;
		lastNoticeKey = '';
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
		hiddenPause = !world.getResource('match').paused;
		world.getResource('match').paused = true;
	} else if (hiddenPause && !welcome.open) {
		world.getResource('match').paused = false;
		hiddenPause = false;
	}
});
window.addEventListener('keydown', function (event) {
	if (event.key === 'Escape' && !welcome.open) {
		selected = [];
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
const frame = function (now: number) {
	if (disposed) return;
	const dt = Math.min(Math.max((now - previous) / 1000, 0), 0.1);
	previous = now;
	if (!busy) {
		world.update(dt * speed);
		draw();
		if (now - lastRefresh > 100) {
			refresh();
			lastRefresh = now;
		}
	}
	raf = requestAnimationFrame(frame);
};
world.getResource('match').paused = true;
mountPlanets();
refresh();
welcome.showModal();
raf = requestAnimationFrame(frame);
window.addEventListener('pagehide', function (event) {
	if (event.persisted) return;
	disposed = true;
	cancelAnimationFrame(raf);
	void world.dispose();
});
