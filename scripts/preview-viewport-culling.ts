// Actual-adapter browser regression fixture. After `bun run build`, bundle:
// bun build scripts/preview-viewport-culling.ts --outfile dist/issue43-order.js --target browser
// Serve a temporary HTML page in dist that loads this module. It writes no saves.
import { createPixiRenderer } from '../src/pixi-renderer';
import { createGame, units, planets, type Order } from '../src/game';

const world = await createGame();
world.getResource('match').paused = true;
for (const entity of units(world)) world.removeEntity(entity.id);
const home = planets(world)[0];
if (!home) throw new Error('No planet');
for (const [x, owner] of [[80, 'blue'], [85, 'red']] as const) {
	world.spawn({ unit: { x, y: 80, kind: 'transport', cargo: 10, hp: 10,
		target: home.id, phase: 'travel', owner, age: 0 } });
}
const canvas = document.createElement('canvas');
document.body.style.cssText = 'margin:0;background:#0a101b';
document.body.append(canvas);
let camera = { x: 0, y: 0, scale: 1 };
let highlighted: Order | undefined;
const renderer = await createPixiRenderer({
	canvas,
	getViewport: function () { return { width: 200, height: 200 }; },
	getPixelRatio: function () { return 2; },
	getState: function () {
		return { world, map: { width: 200, height: 200, planets: [] }, camera, fitScale: 0.2, highlighted };
	},
});
renderer.draw();
const crossing = function (): ReturnType<typeof renderer.inspect> {
	camera = { x: -1, y: 0, scale: 1 };
	home.components.planet.x = 280; home.components.planet.y = 80;
	for (const entity of units(world)) { entity.components.unit.x = -80; entity.components.unit.y = 80; }
	world.getResource('match').engagements = [{ x1: -40, y1: 100, x2: 240, y2: 100, owner: 'blue' }];
	renderer.draw();
	return renderer.inspect();
};
const highlight = function (): void {
	const first = units(world)[0];
	if (!first) throw new Error('No route unit');
	highlighted = { id: 1, owner: 'blue', state: 'pending', target: home.id,
		departures: [{ unitId: first.id, source: home.id, x: -80, y: 80, age: 0 }] };
	renderer.draw();
};
const arrive = function (): ReturnType<typeof renderer.inspect> {
	for (const entity of units(world)) entity.components.unit.phase = 'orbit';
	highlighted = undefined;
	world.getResource('match').engagements = [];
	renderer.draw();
	return renderer.inspect();
};
Object.defineProperty(window, 'orderHarness', { value: {
	crossing, highlight, arrive,
	pan: function (x: number): ReturnType<typeof renderer.inspect> {
		camera = { ...camera, x }; renderer.draw(); return renderer.inspect();
	},
	inspect: renderer.inspect,
	dispose: async function (): Promise<void> { await renderer.dispose(); await world.dispose(); },
} });
