import ECSpresso from 'ecspresso';
import { COLORS } from './config';
import { generateMap, isMapSize, MAP_SIZES } from './maps';
import type { MapSize, StarMap } from './maps';

const element = function <T extends HTMLElement>(
	id: string,
	constructor: { new (...args: never[]): T },
): T {
	const found = document.getElementById(id);
	if (!(found instanceof constructor)) throw new Error(`Missing ${id}`);
	return found;
};
const svgElement = function (
	tag: string,
	attributes: Readonly<Record<string, string | number>>,
): SVGElement {
	const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
	for (const [name, value] of Object.entries(attributes))
		node.setAttribute(name, String(value));
	return node;
};
const freshMap = function (size: MapSize): StarMap {
	const seed = crypto.getRandomValues(new Uint32Array(1))[0];
	if (seed === undefined) throw new Error('Could not generate a map seed');
	return generateMap(size, seed);
};

const initialState = function (): Record<string, never> {
	return {};
};
const flowBuilder = ECSpresso.create().withScreens(function (screens) {
	return screens
		.add('title', { initialState })
		.add('setup', { initialState })
		.add('playing', { initialState });
});
type FrontMenu = ReturnType<typeof flowBuilder.build>;

export const createFrontMenu = async function (options: {
	start: (map: StarMap) => Promise<void>;
	onPlaying: () => void;
	onMenu: () => void;
}): Promise<FrontMenu> {
	const root = element('front-menu', HTMLDivElement);
	const title = element('title-screen', HTMLElement);
	const setup = element('setup', HTMLElement);
	const app = element('app', HTMLDivElement);
	const newGame = element('new-game', HTMLButtonElement);
	const start = element('start-conquest', HTMLButtonElement);
	const status = element('setup-status', HTMLDivElement);
	const summary = element('summary', HTMLDivElement);
	const detail = element('size-detail', HTMLParagraphElement);
	const preview = document.getElementById('map-preview');
	const stars = document.getElementById('stars');
	if (!(preview instanceof SVGElement) || !(stars instanceof SVGElement))
		throw new Error('Missing menu artwork');
	const sizeButtons = [
		...root.querySelectorAll<HTMLButtonElement>('[data-size]'),
	];
	let size: MapSize = 'medium';
	let map = freshMap(size);
	let starting = false;
	const flow = flowBuilder.build();
	const renderPreview = function (): void {
		preview.setAttribute('viewBox', `0 0 ${map.width} ${map.height}`);
		preview.setAttribute(
			'aria-label',
			`Generated ${size} map with ${map.planets.length} worlds, one starting world per side`,
		);
		preview.replaceChildren();
		for (let i = 0; i < 100; i++)
			preview.append(
				svgElement('circle', {
					cx: (i * 137.57) % map.width,
					cy: (i * 83.37) % map.height,
					r: 1.8,
					fill: '#55758e',
					opacity: 0.6,
				}),
			);
		for (const [name, x, y, radius, owner] of map.planets) {
			const node = svgElement('g', {});
			const label = svgElement('title', {});
			label.textContent = `${name} · ${owner === 'blue' ? 'You' : owner === 'red' ? 'Rival' : 'Neutral'}`;
			node.append(label);
			if (owner !== 'neutral')
				node.append(
					svgElement('circle', {
						cx: x,
						cy: y,
						r: radius + 27,
						fill: COLORS[owner],
						'fill-opacity': 0.07,
						stroke: COLORS[owner],
						'stroke-width': 3,
						'stroke-opacity': 0.6,
					}),
				);
			node.append(
				svgElement('circle', {
					cx: x,
					cy: y,
					r: radius,
					fill: COLORS[owner],
					'fill-opacity': owner === 'neutral' ? 0.6 : 1,
				}),
			);
			preview.append(node);
		}
		const count = document.createElement('strong');
		count.textContent = `${map.planets.length} worlds`;
		summary.replaceChildren(
			count,
			' · 1 rival',
			document.createElement('br'),
			'One starting world per side',
		);
		detail.textContent = MAP_SIZES[size].detail;
		for (const button of sizeButtons)
			button.setAttribute('aria-pressed', String(button.dataset.size === size));
	};
	for (let i = 0; i < 110; i++)
		stars.append(
			svgElement('circle', {
				cx: (i * 137.57) % 720,
				cy: (i * 83.37) % 420,
				r: i % 9 === 0 ? 1.3 : 0.65,
				fill: '#9eb6cc',
				opacity: 0.15 + (i % 4) * 0.1,
			}),
		);
	const showMenu = function (screen: 'title' | 'setup'): void {
		options.onMenu();
		app.hidden = true;
		root.hidden = false;
		title.hidden = screen !== 'title';
		setup.hidden = screen !== 'setup';
		root.scrollTop = 0;
		if (screen === 'title') newGame.focus();
		else
			sizeButtons
				.find(function (button) {
					return button.dataset.size === size;
				})
				?.focus();
	};
	flow.onScreenEnter('title', function () {
		showMenu('title');
	});
	flow.onScreenEnter('setup', function () {
		showMenu('setup');
	});
	flow.onScreenEnter('playing', function () {
		root.hidden = true;
		app.hidden = false;
		options.onPlaying();
	});
	newGame.addEventListener('click', function () {
		void flow.setScreen('setup', {});
	});
	element('back', HTMLButtonElement).addEventListener('click', function () {
		if (!starting) void flow.setScreen('title', {});
	});
	for (const button of sizeButtons)
		button.addEventListener('click', function () {
			if (
				starting ||
				!isMapSize(button.dataset.size) ||
				button.dataset.size === size
			)
				return;
			size = button.dataset.size;
			map = freshMap(size);
			renderPreview();
			status.textContent = `${MAP_SIZES[size].label} map generated: ${map.planets.length} worlds.`;
		});
	element('reroll', HTMLButtonElement).addEventListener('click', function () {
		if (starting) return;
		map = freshMap(size);
		renderPreview();
		status.textContent = 'New layout generated.';
	});
	start.addEventListener('click', async function () {
		if (starting) return;
		starting = true;
		const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')];
		for (const button of buttons) button.disabled = true;
		status.textContent = 'Preparing your galaxy…';
		try {
			await options.start(map);
			await flow.setScreen('playing', {});
			status.textContent = '';
		} catch (error) {
			console.error('Could not start conquest', error);
			status.textContent = 'Could not start conquest. Please try again.';
		} finally {
			starting = false;
			for (const button of buttons) button.disabled = false;
		}
	});
	renderPreview();
	await flow.initialize();
	await flow.setScreen('title', {});
	return flow;
};
