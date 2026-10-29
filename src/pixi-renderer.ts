import ECSpresso from 'ecspresso';
import { createWeaponEffects } from './visual-effects';
import { turnToward, SHIP_TURN_RATE } from './turning';
import { loadAtlasAssets } from './atlas-assets';
import { createRenderer2DPlugin, createSpriteComponents } from 'ecspresso/plugins/rendering/renderer2D';
import { Application, Container, Graphics, Sprite, TilingSprite, Texture, CanvasSource } from 'pixi.js';
import { COLORS, CONFIG, SIDES, isHostile, type Owner, type Side } from './config';
import type { Camera } from './camera';
import type { StarMap } from './maps';
import { isBlockaded, planets, shipsAt, orderUnits, unitPoint } from './game';
import type { Game, Order } from './game';
import { travelAim } from './movement';
import { interceptionAims } from './fleet-interception';
import { createRenderCandidates, worldViewport, type RenderSelection } from './render-candidates';
import { canvasViewport, dashedLine, shipDetailZoom, planetPlatformOrbitRadius } from './render-geometry';

interface RendererState {
	world: Game;
	map: StarMap;
	camera: Camera;
	fitScale: number;
	highlighted: Order | undefined;
}
interface RendererInspection {
	ships: number; totalShips: number; candidates: number; indexEntries: number; platforms: number; travelLines: number; textures: number; entities: number; tickerStarted: boolean; width: number; height: number; resolution: number;
}
interface RendererDependencies {
	canvas: HTMLCanvasElement;
	getState: () => RendererState;
	getPixelRatio: () => number;
	getViewport: () => { width: number; height: number };
	measure?: <T>(name: string, action: () => T) => T;
}
interface PlatformView {
	entityId: number;
	sprite: Sprite;
	textureKey: string;
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
	const atlas = await loadAtlasAssets();

	const globeViews = new Map<number, Sprite>();
	const app = new Application();
	await app.init({ canvas: dependencies.canvas, width: 1, height: 1,
		preference: 'webgl', backgroundAlpha: 0, antialias: false,
		autoStart: false, sharedTicker: false, autoDensity: false, eventMode: 'none',
		eventFeatures: { move: false, click: false, wheel: false, globalMove: false } });
	const globeTextures = atlas.globes.map(function ({ globe }) {
		return new Texture({ source: new CanvasSource({ resource: globe }) });
	});
	const root = new Container();
	root.eventMode = 'none';
	// Fixed screen-space stars, including outside the map.
	const stars = new TilingSprite({ texture: Texture.EMPTY, eventMode: 'none' });
	let starTexture: Texture | undefined;
	app.stage.addChild(stars);
	app.stage.addChild(root);
	const presentation = ECSpresso.create()
		.withPlugin(createRenderer2DPlugin({ app, rootContainer: root, startLoop: false,
			renderLayers: ['background', 'routes', 'trails', 'ships', 'effects'] }))
		.build();
	const background = new Graphics();
	const routes = new Graphics();
	const effects = new Graphics();
	const travelLines = new Container();
	const trails = new Container();
	const weaponEffects = createWeaponEffects();
	const textures = new Map<string, Texture>();
	const fleet = new Map<number, { entityId: number; display: Container; hull: Sprite; badge: Sprite | undefined; trail: Sprite; heading: number; time: number }>();
	const routeViews = new Map<number, Sprite>();
	const destroyStage = function (): void {
		for (const graphics of [background, routes, effects]) graphics.destroy();
		travelLines.destroy({ children: true });
		trails.destroy({ children: true });
		app.destroy(false, { children: true });
		starTexture?.destroy(true);
		for (const texture of globeTextures) texture.destroy(true);
	};
	const candidates = await createRenderCandidates().catch(async function (error: unknown) {
		await presentation.dispose().finally(destroyStage);
		throw error;
	});
	let counts = { totalShips: 0, candidates: 0, indexEntries: 0 };
	const platformViews = new Map<number, PlatformView[]>();
	let currentWorld: Game | undefined;
	let currentMap: StarMap | undefined;
	let disposal: Promise<void> | undefined;
	let disposed = false;
	try {
		await presentation.initialize();
		// Recreated hulls must retain unit order rather than append above survivors.
		for (const layer of root.children) layer.sortableChildren = true;
		for (const [graphics, renderLayer] of [[background, 'background'], [routes, 'routes'], [effects, 'effects']] as const) {
			presentation.spawn({ graphics, renderLayer });
		}
		presentation.spawn({ container: travelLines, renderLayer: 'routes' });
		presentation.spawn({ container: trails, renderLayer: 'trails' });
	} catch (error) {
		await candidates.dispose();
		await presentation.dispose().finally(destroyStage);
		throw error;
	}
	const texture = function (owner: Side, kind: 'ship' | 'transport', detail: 1 | 2 | 3): Texture {
		const key = `${owner}:${kind}:${detail}`;
		const cached = textures.get(key);
		if (cached) return cached;
		const created = makeTexture(32, 4, function (context) {
			context.drawImage(kind === 'ship' ? atlas.warship : atlas.transport, -16, -16, 32, 32);
			context.fillStyle = COLORS[owner];
			context.strokeStyle = '#0c2a31';
			context.lineWidth = 0.8;
			context.beginPath(); context.arc(-6, 0, 2.8, 0, Math.PI * 2);
			context.fill(); context.stroke();
		});
		textures.set(key, created);
		return created;
	};
	// One shared, tapered exhaust texture; no particle entities or per-frame textures.
	const exhaustTexture = function (): Texture {
		const cached = textures.get('exhaust');
		if (cached) return cached;
		const created = makeTexture(64, 2, function (context) {
			const gradient = context.createLinearGradient(-32, 0, 32, 0);
			gradient.addColorStop(0, '#ffffff00');
			gradient.addColorStop(0.65, '#ffffff55');
			gradient.addColorStop(1, '#ffffffff');
			context.fillStyle = gradient;
			context.beginPath();
			context.moveTo(-32, 0); context.lineTo(32, -12);
			context.lineTo(32, 12); context.closePath(); context.fill();
		});
		textures.set('exhaust', created);
		return created;
	};
	const platformTextureKey = function (owner: Owner, detail: 1 | 2 | 3): string {
		return `platform:${owner}:${detail}`;
	};
	const platformTexture = function (owner: Owner, detail: 1 | 2 | 3): Texture {
		const key = platformTextureKey(owner, detail);
		const cached = textures.get(key);
		if (cached) return cached;
		const created = makeTexture(32, 4, function (context) {
			context.drawImage(atlas.platform, -12, -12, 24, 24);
			context.fillStyle = COLORS[owner];
			context.strokeStyle = '#0c2a31';
			context.lineWidth = 0.8;
			context.beginPath(); context.arc(-2, 0, 2.5, 0, Math.PI * 2);
			context.fill(); context.stroke();
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
		weaponEffects.reset();
		for (const { entityId, display, trail } of fleet.values()) {
			presentation.removeEntity(entityId);
			display.destroy({ children: true });
			trail.destroy();
		}
		fleet.clear();
		for (const sprite of globeViews.values()) sprite.destroy();
		globeViews.clear();
		for (const route of routeViews.values()) route.destroy();
		routeViews.clear();
		candidates.reset();
		counts = { totalShips: 0, candidates: 0, indexEntries: 0 };
		for (const views of platformViews.values()) {
			for (const view of views) {
				presentation.removeEntity(view.entityId);
				view.sprite.destroy();
			}
		}
		platformViews.clear();
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
		root.position.set(camera.x, camera.y);
		root.scale.set(camera.scale);
		if (map !== currentMap) {
			const tile = document.createElement('canvas');
			tile.width = map.width; tile.height = map.height;
			const context = tile.getContext('2d');
			if (!context) throw new Error('Canvas 2D is required to prepare the star field');
			for (let i = 0; i < 460; i++) {
				context.fillStyle = i % 4 === 0 ? '#738ea45c' : '#42627b55';
				context.fillRect((i * 137.57) % map.width, (i * 83.37) % map.height, i % 5 === 0 ? 1.8 : 1, i % 5 === 0 ? 1.8 : 1);
			}
			const previous = starTexture;
			starTexture = new Texture({ source: new CanvasSource({ resource: tile }) });
			stars.texture = starTexture;
			previous?.destroy(true);
			currentMap = map;
		}
		stars.width = viewport.width; stars.height = viewport.height;
		// Keep the star field in screen space; only the map root follows the camera.
		routes.clear(); effects.clear();
		const match = world.getResource('match');
		for (const [index, globe] of atlas.globes.entries()) {
			if (globe.update(match.time)) globeTextures[index]?.source.update();
		}
		const ids = new Set(planets(world).map(function (entity) { return entity.id; }));
		for (const [id, sprite] of globeViews) if (!ids.has(id)) { sprite.destroy(); globeViews.delete(id); }
		const intercepts = interceptionAims(world);
		const zoom = camera.scale / fitScale;
		for (const { id, components: { planet: p } } of planets(world)) {
			if (!p.carrier) {
				let globe = globeViews.get(id);
				if (!globe) {
					const variant = [...p.name].reduce(function (sum, letter) { return sum + letter.charCodeAt(0); }, 0) % globeTextures.length;
					globe = new Sprite(globeTextures[variant]); globe.anchor.set(0.5);
					background.addChild(globe); globeViews.set(id, globe);
				}
				globe.position.set(p.x, p.y); globe.width = p.radius * 2; globe.height = p.radius * 2;
			}
			const bombardment = p.carrier?.bombardment;
			const target = bombardment ? world.getComponent(bombardment.target, 'planet') : undefined;
			if (bombardment && target) {
				const charging = !p.carrier?.destination;
				const progress = bombardment.elapsed / CONFIG.bombardmentCharge;
				routes.moveTo(p.x, p.y).lineTo(target.x, target.y).stroke({ color: '#ffd083', alpha: charging ? 0.65 : 0.25, width: (charging ? 2 : 1) / camera.scale });
				routes.circle(target.x, target.y, target.radius + 10 / camera.scale).stroke({ color: '#ffd083', alpha: 0.5, width: 1 / camera.scale });
				if (progress > 0) routes.moveTo(target.x, target.y - target.radius - 10 / camera.scale)
					.arc(target.x, target.y, target.radius + 10 / camera.scale, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress).stroke({ color: '#ffd083', width: 4 / camera.scale });
			}
			if (p.carrier?.destination) {
				routes.moveTo(p.x, p.y).lineTo(p.carrier.destination.x, p.carrier.destination.y).stroke({ color: COLORS[p.owner], alpha: 0.6, width: 1.5 / camera.scale });
				routes.circle(p.carrier.destination.x, p.carrier.destination.y, 5 / camera.scale).stroke({ color: COLORS[p.owner], width: 1 / camera.scale });
			}
			routes.circle(p.x, p.y, p.radius + 20).stroke({ color: '#4d739517', width: 1 });
			const platformCount = Math.max(0, Math.ceil(p.guns));
			const existingPlatforms = platformViews.get(id) ?? [];
			while (existingPlatforms.length > platformCount) {
				const removed = existingPlatforms.pop();
				if (!removed) continue;
				presentation.removeEntity(removed.entityId);
				removed.sprite.destroy();
			}
			if (platformCount > 0) {
				const orbitRadius = planetPlatformOrbitRadius(p.radius);
				routes.circle(p.x, p.y, orbitRadius).stroke({
					color: COLORS[p.owner],
					alpha: 0.13,
					width: 1,
				});
				const detail = shipDetailZoom(zoom);
				const key = platformTextureKey(p.owner, detail);
				for (let index = 0; index < platformCount; index++) {
					let view = existingPlatforms[index];
					if (!view) {
						const sprite = new Sprite(platformTexture(p.owner, detail));
						sprite.anchor.set(0.5);
						const entity = presentation.spawn({
							...createSpriteComponents(sprite),
							renderLayer: 'ships',
						});
						view = { entityId: entity.id, sprite, textureKey: key };
						existingPlatforms.push(view);
					}
					if (view.textureKey !== key) {
						view.sprite.texture = platformTexture(p.owner, detail);
						view.textureKey = key;
					}
					const angle =
						match.time * 0.12 + (Math.PI * 2 * index) / platformCount;
					const transform = presentation.getComponent(
						view.entityId,
						'localTransform',
					);
					if (transform) {
						transform.x = p.x + Math.cos(angle) * orbitRadius;
						transform.y = p.y + Math.sin(angle) * orbitRadius;
						transform.rotation = angle;
						presentation.markChanged(view.entityId, 'localTransform');
					}
				}
				platformViews.set(id, existingPlatforms);
			} else platformViews.delete(id);
			const orbiting = SIDES.filter(function (side) { return shipsAt(world, id, side).length > 0; });
			const hostile = orbiting.find(function (side) { return side !== p.owner; });
			if (hostile) {
				const color = COLORS[hostile];
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
			if (orbiting.some(function (side) { return orbiting.some(function (other) { return isHostile(side, other); }) || (isHostile(side, p.owner) && p.guns > 0); })) {
				const angle = match.time * 4;
				routes.moveTo(p.x + Math.cos(angle) * (p.radius + 19), p.y + Math.sin(angle) * (p.radius + 19))
					.lineTo(p.x - Math.cos(angle) * (p.radius + 19), p.y - Math.sin(angle) * (p.radius + 19))
					.stroke({ color: '#ffe3a9', width: 1.7 });
				const pulse = (match.time * 5 + id * 0.37) % 1;
				const impactX = p.x - Math.cos(angle) * (p.radius + 19);
				const impactY = p.y - Math.sin(angle) * (p.radius + 19);
				effects.circle(impactX, impactY, 2 + pulse * 9).stroke({ color: '#ffe3a9', alpha: (1 - pulse) * 0.8, width: 1.5 });
				effects.circle(impactX, impactY, 2).fill({ color: '#fff4d8', alpha: 1 - pulse });
			}
		}
		if (highlighted) {
			for (const entity of orderUnits(world, highlighted)) {
				const u = entity.components.unit;
				const target = world.getComponent(u.target, 'planet');
				if (!target) continue;
				const point = unitPoint(u, target, match.time, entity.id, intercepts.get(entity.id));
				const aim = u.phase === 'travel' ? intercepts.get(entity.id) ?? travelAim(u, target) : target;
				const segments = highlighted.state === 'pending'
					? dashedLine(point, aim, 8 / camera.scale, 5 / camera.scale)
					: [[point, aim]] as const;
				for (const [from, to] of segments) routes.moveTo(from.x, from.y).lineTo(to.x, to.y);
			}
			routes.stroke({ color: COLORS.blue, width: 2 / camera.scale });
		}
		const select = function (): RenderSelection { return candidates.select(world, camera, viewport.width, viewport.height, zoom >= 3.5, map); };
		const selected = dependencies.measure ? dependencies.measure('render.index', select) : select();
		counts = { totalShips: selected.all.length, candidates: selected.candidates, indexEntries: selected.entries };
		// Lines are independent of hull candidates: either endpoint can be offscreen.
		const traveling = new Set<number>();
		for (const { id, components: { unit: u } } of selected.all) {
			if (u.hp <= 0 || u.phase !== 'travel') continue;
			const target = world.getComponent(u.target, 'planet');
			if (!target) continue;
			traveling.add(id);
			const point = unitPoint(u, target, match.time, id, intercepts.get(id));
			let route = routeViews.get(id);
			if (!route) {
				route = new Sprite(travelTexture());
				route.anchor.set(0, 0.5);
				route.alpha = 0x22 / 255;
				travelLines.addChild(route);
				routeViews.set(id, route);
			}
			const aim = intercepts.get(id) ?? travelAim(u, target);
			const dx = aim.x - point.x;
			const dy = aim.y - point.y;
			route.position.set(point.x, point.y);
			route.rotation = Math.atan2(dy, dx);
			route.width = Math.hypot(dx, dy);
			route.height = 4;
			route.tint = COLORS[u.owner];
		}
		for (const [id, route] of routeViews) {
			if (traveling.has(id)) continue;
			route.destroy(); routeViews.delete(id);
		}
		const live = new Set<number>();
		for (const [drawOrder, { id, components: { unit: u } }] of selected.visible.entries()) {
			const target = world.getComponent(u.target, 'planet');
			if (!target) continue;
			live.add(id);
			const point = unitPoint(u, target, match.time, id, intercepts.get(id));
			let view = fleet.get(id);
			if (!view) {
				const hull = new Sprite(); hull.anchor.set(0.5);
				const entity = presentation.spawn({ ...createSpriteComponents(hull), renderLayer: 'ships' });
				const trail = new Sprite(exhaustTexture());
				trail.anchor.set(1, 0.5);
				trails.addChild(trail);
				view = { entityId: entity.id, display: hull, hull, badge: undefined, trail, heading: point.angle, time: match.time };
				fleet.set(id, view);
			}
			view.heading = turnToward(view.heading, point.angle, SHIP_TURN_RATE, Math.max(0, match.time - view.time));
			view.time = match.time;
			const thrust = 0.9 + 0.1 * Math.sin(match.time * 19 + id * 2.4);
			view.trail.position.set(point.x - Math.cos(view.heading) * 10, point.y - Math.sin(view.heading) * 10);
			view.trail.rotation = view.heading;
			view.trail.width = (u.phase === 'travel' ? 28 : 12) * thrust;
			view.trail.height = u.kind === 'transport' ? 6 : 8;
			view.trail.tint = COLORS[u.owner];
			view.trail.alpha = u.phase === 'travel' ? 0.75 : 0.4;
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
			view.display.zIndex = drawOrder + 1;
			if (view.badge) view.badge.visible = showCargo;
			if (showCargo && view.badge) {
				view.badge.texture = cargoTexture(u.owner, u.cargo);
				view.badge.rotation = -view.heading;
				view.badge.scale.set(1 / camera.scale);
			}
			const transform = presentation.getComponent(view.entityId, 'localTransform');
			if (transform) {
				transform.x = point.x; transform.y = point.y; transform.rotation = view.heading;
				presentation.markChanged(view.entityId, 'localTransform');
			}
		}
		for (const [id, view] of fleet) {
			if (live.has(id)) continue;
			presentation.removeEntity(view.entityId);
			view.display.destroy({ children: true });
			view.trail.destroy();
			fleet.delete(id);
		}
		const bounds = worldViewport(camera, viewport.width, viewport.height);
		for (const shot of weaponEffects.update(match.time, match.engagements, function (shot) {
			return Math.max(shot.x1, shot.x2) + 20 >= bounds.left && Math.min(shot.x1, shot.x2) - 20 <= bounds.right &&
				Math.max(shot.y1, shot.y2) + 20 >= bounds.top && Math.min(shot.y1, shot.y2) - 20 <= bounds.bottom;
		})) {
			const age = match.time - shot.started;
			const fade = Math.max(0, 1 - age / 0.24);
			const color = COLORS[shot.owner];
			const dx = shot.x2 - shot.x1;
			const dy = shot.y2 - shot.y1;
			const distance = Math.hypot(dx, dy);
			const inset = distance > 0 ? Math.min(12, distance / 4) / distance : 0;
			const impactX = shot.x2 - dx * inset;
			const impactY = shot.y2 - dy * inset;
			effects.moveTo(shot.x1, shot.y1).lineTo(impactX, impactY).stroke({ color, alpha: fade * 0.22, width: 7, cap: 'round' });
			effects.moveTo(shot.x1, shot.y1).lineTo(impactX, impactY).stroke({ color, alpha: fade, width: 2, cap: 'round' });
			effects.circle(shot.x1, shot.y1, 2.5 * fade).fill({ color: '#effbff', alpha: fade });
			effects.circle(impactX, impactY, 4 + age * 32).stroke({ color, alpha: fade * 0.7, width: 1 });
			for (let spark = 0; spark < 4; spark++) {
				const angle = spark * Math.PI / 2 + shot.started * 7;
				const distance = 4 + age * 35;
				effects.moveTo(impactX + Math.cos(angle) * distance, impactY + Math.sin(angle) * distance)
					.lineTo(impactX + Math.cos(angle) * (distance + 5), impactY + Math.sin(angle) * (distance + 5))
					.stroke({ color: '#ffe5aa', alpha: fade, width: 1 });
			}
		}
		// Transform propagation and scene wiring run even while gameplay is paused.
		presentation.update(0);
		app.render();
	};
	const dispose = function (): Promise<void> {
		if (disposal) return disposal;
		disposed = true;
		clearFleet();
		disposal = Promise.all([candidates.dispose(), presentation.dispose()]).then(function () {}).finally(function () {
			// The plugin detaches display components; the adapter owns destruction.
			for (const graphics of [background, routes, effects]) graphics.destroy();
			travelLines.destroy({ children: true });
			trails.destroy({ children: true });
			app.destroy(false, { children: true });
			for (const shared of textures.values()) shared.destroy(true);
			textures.clear();
			for (const texture of globeTextures) texture.destroy(true);
		});
		return disposal;
	};
	const inspect = function (): RendererInspection {
		return { ships: fleet.size, ...counts, platforms: [...platformViews.values()].reduce(function (count, views) { return count + views.length; }, 0),
			travelLines: travelLines.children.length, textures: textures.size + cargoTextures.size + globeTextures.length, entities: presentation.entityCount,
			tickerStarted: app.ticker.started, width: app.screen.width, height: app.screen.height, resolution: app.renderer.resolution };
	};
	return { draw, reset, inspect, dispose };
};
