import ECSpresso from 'ecspresso';
import { createRenderer2DPlugin, createSpriteComponents } from 'ecspresso/plugins/rendering/renderer2D';
import { Application, Container, Graphics, Sprite, Texture, CanvasSource } from 'pixi.js';
import { COLORS, type Side } from './config';
import type { Camera } from './camera';
import type { StarMap } from './maps';
import { isBlockaded, planets, shipsAt, orderUnits, unitPoint, units } from './game';
import type { Game, Order } from './game';
import { createShipPainter } from './ship-art';
import { canvasViewport, mapClipInsets, dashedLine, shipDetailZoom } from './render-geometry';

interface RendererState {
	world: Game;
	map: StarMap;
	camera: Camera;
	fitScale: number;
	highlighted: Order | undefined;
}
interface RendererInspection {
	ships: number; travelLines: number; textures: number; entities: number; tickerStarted: boolean; width: number; height: number; resolution: number;
}
interface RendererDependencies {
	canvas: HTMLCanvasElement;
	getState: () => RendererState;
	getPixelRatio: () => number;
	getViewport: () => { width: number; height: number };
}

const makeTexture = function (size: number, resolution: number, paint: (context: CanvasRenderingContext2D) => void): Texture {
	const canvas = document.createElement('canvas');
	canvas.width = size * resolution;
	canvas.height = size * resolution;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas 2D is required to prepare ship textures');
	context.scale(resolution, resolution);
	context.translate(size / 2, size / 2);
	paint(context);
	return new Texture({ source: new CanvasSource({ resource: canvas, resolution }) });
};

// Presentation-only ECS; no Pixi objects or renderer entities enter game saves.
export const createPixiRenderer = async function (dependencies: RendererDependencies): Promise<{
	draw: () => void;
	reset: () => void;
	inspect: () => RendererInspection;
	dispose: () => Promise<void>;
}> {
	const app = new Application();
	await app.init({ canvas: dependencies.canvas, width: 1, height: 1,
		preference: 'webgl', backgroundAlpha: 0, antialias: false,
		autoStart: false, sharedTicker: false, autoDensity: false, eventMode: 'none',
		eventFeatures: { move: false, click: false, wheel: false, globalMove: false } });
	const root = new Container();
	root.eventMode = 'none';
	app.stage.addChild(root);
	const presentation = ECSpresso.create()
		.withPlugin(createRenderer2DPlugin({ app, rootContainer: root, startLoop: false,
			renderLayers: ['background', 'routes', 'ships', 'effects'] }))
		.build();
	const background = new Graphics();
	const routes = new Graphics();
	const effects = new Graphics();
	const travelLines = new Container();
	const textures = new Map<string, Texture>();
	const fleet = new Map<number, { entityId: number; display: Container; hull: Sprite; badge: Sprite | undefined; route: Sprite | undefined }>();
	let currentWorld: Game | undefined;
	let currentMap: StarMap | undefined;
	let disposal: Promise<void> | undefined;
	let disposed = false;
	try {
		await presentation.initialize();
		for (const [graphics, renderLayer] of [[background, 'background'], [routes, 'routes'], [effects, 'effects']] as const) {
			presentation.spawn({ graphics, renderLayer });
		}
		presentation.spawn({ container: travelLines, renderLayer: 'routes' });
	} catch (error) {
		await presentation.dispose().finally(function () {
			for (const graphics of [background, routes, effects]) graphics.destroy();
			travelLines.destroy({ children: true });
			app.destroy(false, { children: true });
		});
		throw error;
	}
	const texture = function (owner: Side, kind: 'ship' | 'transport', detail: 1 | 2 | 3): Texture {
		const key = `${owner}:${kind}:${detail}`;
		const cached = textures.get(key);
		if (cached) return cached;
		const created = makeTexture(32, 4, function (context) {
			const painter = createShipPainter(context);
			if (kind === 'ship') painter.warship(owner, detail === 3 ? 2.5 : detail === 2 ? 1.75 : 1);
			else painter.transport(owner, detail === 3 ? 2.5 : detail === 2 ? 1.75 : 1);
		});
		textures.set(key, created);
		return created;
	};
	// A one-world-unit stroke with transparent shoulders. Mipmaps preserve its
	// coverage when zoomed out, without full-frame multisample antialiasing.
	const travelTexture = function (): Texture {
		const cached = textures.get('travel-line');
		if (cached) return cached;
		const canvas = document.createElement('canvas');
		canvas.width = 8;
		canvas.height = 32;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Canvas 2D is required to prepare route textures');
		context.fillStyle = '#ffffff';
		context.fillRect(0, 12, 8, 8);
		const created = new Texture({ source: new CanvasSource({ resource: canvas,
			resolution: 8, autoGenerateMipmaps: true, scaleMode: 'linear' }) });
		textures.set('travel-line', created);
		return created;
	};
	const cargoTextures = new Map<string, Texture>();
	const cargoTexture = function (owner: Side, cargo: number): Texture {
		const key = `${owner}:cargo:${cargo}`;
		const cached = cargoTextures.get(key);
		if (cached) return cached;
		// Loaded saves permit larger cargo values than normal production. Leave
		// room for the complete label, as the original Canvas text was unclipped.
		const created = makeTexture(Math.max(20, String(cargo).length * 7 + 2), 3, function (context) {
			context.fillStyle = '#10202b';
			context.beginPath();
			context.arc(0, 0, 8, 0, Math.PI * 2);
			context.fill();
			context.strokeStyle = COLORS[owner];
			context.lineWidth = 1;
			context.stroke();
			context.fillStyle = owner === 'blue' ? '#dcf7ff' : '#ffebe5';
			context.font = 'bold 10px ui-monospace, monospace';
			context.textAlign = 'center';
			context.textBaseline = 'middle';
			context.fillText(String(cargo), 0, 0);
		});
		cargoTextures.set(key, created);
		return created;
	};
	const clearFleet = function (): void {
		for (const { entityId, display, route } of fleet.values()) {
			presentation.removeEntity(entityId);
			display.destroy({ children: true });
			route?.destroy();
		}
		fleet.clear();
		for (const shared of cargoTextures.values()) shared.destroy(true);
		cargoTextures.clear();
	};
	const reset = function (): void { clearFleet(); currentWorld = undefined; };
	const draw = function (): void {
		if (disposed) return;
		const { world, map, camera, fitScale, highlighted } = dependencies.getState();
		if (world !== currentWorld) { clearFleet(); currentWorld = world; }
		const viewport = dependencies.getViewport();
		if (viewport.width <= 0 || viewport.height <= 0) return;
		const resolution = Math.min(dependencies.getPixelRatio() || 1, 3);
		if (app.screen.width !== viewport.width || app.screen.height !== viewport.height || app.renderer.resolution !== resolution) {
			app.renderer.resize(viewport.width, viewport.height, resolution);
		}
		const box = canvasViewport(camera, viewport.width, viewport.height);
		const style = dependencies.canvas.style;
		style.left = `${box.left}px`; style.top = `${box.top}px`;
		style.width = `${box.width}px`; style.height = `${box.height}px`;
		// Preserve the old map-canvas clip without a full-frame GPU stencil pass.
		const clip = mapClipInsets(camera, viewport.width, viewport.height, map.width, map.height);
		style.clipPath = `inset(${clip.top}px ${clip.right}px ${clip.bottom}px ${clip.left}px)`;
		root.position.set(camera.x, camera.y);
		root.scale.set(camera.scale);
		if (map !== currentMap) {
			background.clear();
			for (let i = 0; i < 460; i++) {
				background.rect((i * 137.57) % map.width, (i * 83.37) % map.height, i % 5 === 0 ? 1.8 : 1, i % 5 === 0 ? 1.8 : 1)
					.fill(i % 4 === 0 ? '#738ea45c' : '#42627b55');
			}
			currentMap = map;
		}
		routes.clear(); effects.clear();
		const match = world.getResource('match');
		const zoom = camera.scale / fitScale;
		for (const { id, components: { planet: p } } of planets(world)) {
			routes.circle(p.x, p.y, p.radius + 20).stroke({ color: '#4d739517', width: 1 });
			const blue = shipsAt(world, id, 'blue').length;
			const red = shipsAt(world, id, 'red').length;
			if ((blue > 0 && p.owner !== 'blue') || (red > 0 && p.owner !== 'red')) {
				const color = blue > 0 && p.owner !== 'blue' ? COLORS.blue : COLORS.red;
				const radius = p.radius + 17;
				if (isBlockaded(world, id)) {
					// Canvas lineDashOffset = -time*10; dash starts advance clockwise.
					for (let start = (match.time * 10) % 12 - 12; start < Math.PI * 2 * radius; start += 12) {
						const a = Math.max(0, start) / radius;
						const b = Math.min(Math.PI * 2 * radius, start + 6) / radius;
						if (b > a) routes.moveTo(p.x + Math.cos(a) * radius, p.y + Math.sin(a) * radius)
							.arc(p.x, p.y, radius, a, b).stroke({ color, width: 2 });
					}
				} else routes.circle(p.x, p.y, radius).stroke({ color, width: 1 });
			}
			if ((blue > 0 || (p.owner === 'blue' && p.guns > 0)) && (red > 0 || (p.owner === 'red' && p.guns > 0))) {
				const angle = match.time * 4;
				routes.moveTo(p.x + Math.cos(angle) * (p.radius + 19), p.y + Math.sin(angle) * (p.radius + 19))
					.lineTo(p.x - Math.cos(angle) * (p.radius + 19), p.y - Math.sin(angle) * (p.radius + 19))
					.stroke({ color: '#ffe3a9', width: 1.7 });
			}
		}
		if (highlighted) {
			for (const entity of orderUnits(world, highlighted)) {
				const u = entity.components.unit;
				const target = world.getComponent(u.target, 'planet');
				if (!target) continue;
				const point = unitPoint(u, target, match.time, entity.id);
				const segments = highlighted.state === 'pending'
					? dashedLine(point, target, 8 / camera.scale, 5 / camera.scale)
					: [[point, target]] as const;
				for (const [from, to] of segments) routes.moveTo(from.x, from.y).lineTo(to.x, to.y);
			}
			routes.stroke({ color: COLORS.blue, width: 2 / camera.scale });
		}
		const allUnits = units(world);
		const live = new Set<number>();
		for (const { id, components: { unit: u } } of allUnits) {
			if (u.hp <= 0) continue;
			const target = world.getComponent(u.target, 'planet');
			if (!target) continue;
			live.add(id);
			const point = unitPoint(u, target, match.time, id);

			let view = fleet.get(id);
			if (!view) {
				const hull = new Sprite(); hull.anchor.set(0.5);
				const entity = presentation.spawn({ ...createSpriteComponents(hull), renderLayer: 'ships' });
				view = { entityId: entity.id, display: hull, hull, badge: undefined, route: undefined };
				fleet.set(id, view);
			}
			if (u.phase === 'travel') {
				if (!view.route) {
					view.route = new Sprite(travelTexture());
					view.route.anchor.set(0, 0.5);
					view.route.alpha = 0x22 / 255;
					travelLines.addChild(view.route);
				}
				const dx = target.x - point.x;
				const dy = target.y - point.y;
				view.route.position.set(point.x, point.y);
				view.route.rotation = Math.atan2(dy, dx);
				view.route.width = Math.hypot(dx, dy);
				view.route.height = 4;
				view.route.tint = COLORS[u.owner];
			} else if (view.route) {
				view.route.destroy();
				view.route = undefined;
			}
			view.hull.texture = texture(u.owner, u.kind, shipDetailZoom(zoom));
			const showCargo = u.kind === 'transport' && zoom >= 3.5;
			if (showCargo && !view.badge) {
				// Sprite children are deprecated in Pixi v8. Promote only ships that
				// need a badge, preserving their existing order within the fleet layer.
				const parent = view.hull.parent;
				const index = parent?.getChildIndex(view.hull);
				presentation.removeComponent(view.entityId, 'sprite');
				const container = new Container();
				view.badge = new Sprite();
				view.badge.anchor.set(0.5);
				view.hull.position.set(0);
				view.hull.rotation = 0;
				view.hull.scale.set(1);
				container.addChild(view.hull, view.badge);
				presentation.addComponent(view.entityId, 'container', container);
				// renderer2D gates sync on changed worldTransform, even for a newly
				// attached display component. Paused promotion needs an initial sync.
				presentation.markChanged(view.entityId, 'worldTransform');
				if (parent && index !== undefined) parent.setChildIndex(container, index);
				view.display = container;
			}
			if (view.badge) view.badge.visible = showCargo;
			if (showCargo && view.badge) {
				view.badge.texture = cargoTexture(u.owner, u.cargo);
				view.badge.rotation = -point.angle;
				view.badge.scale.set(1 / camera.scale);
			}
			const transform = presentation.getComponent(view.entityId, 'localTransform');
			if (transform) {
				transform.x = point.x; transform.y = point.y; transform.rotation = point.angle;
				presentation.markChanged(view.entityId, 'localTransform');
			}
		}
		for (const [id, view] of fleet) {
			if (live.has(id)) continue;
			presentation.removeEntity(view.entityId);
			view.display.destroy({ children: true });
			view.route?.destroy();
			fleet.delete(id);
		}
		for (const shot of match.engagements) {
			effects.moveTo(shot.x1, shot.y1).lineTo(shot.x2, shot.y2).stroke({ color: COLORS[shot.owner], alpha: 0.35, width: 6, cap: 'round' });
			effects.moveTo(shot.x1, shot.y1).lineTo(shot.x2, shot.y2).stroke({ color: COLORS[shot.owner], alpha: 0.95, width: 2, cap: 'round' });
		}
		// Transform propagation and scene wiring run even while gameplay is paused.
		presentation.update(0);
		app.render();
	};
	const dispose = function (): Promise<void> {
		if (disposal) return disposal;
		disposed = true;
		clearFleet();
		disposal = presentation.dispose().finally(function () {
			// The plugin detaches display components; the adapter owns destruction.
			for (const graphics of [background, routes, effects]) graphics.destroy();
			travelLines.destroy({ children: true });
			app.destroy(false, { children: true });
			for (const shared of textures.values()) shared.destroy(true);
			textures.clear();
		});
		return disposal;
	};
	const inspect = function (): RendererInspection {
		return { ships: fleet.size, travelLines: travelLines.children.length, textures: textures.size + cargoTextures.size, entities: presentation.entityCount,
			tickerStarted: app.ticker.started, width: app.screen.width, height: app.screen.height, resolution: app.renderer.resolution };
	};
	return { draw, reset, inspect, dispose };
};
