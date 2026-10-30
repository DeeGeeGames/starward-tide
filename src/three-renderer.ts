import ECSpresso from 'ecspresso';
import { createRenderer3DPlugin, createGroupComponents, createMeshComponents } from 'ecspresso/plugins/rendering/renderer3D';
import { AmbientLight, CanvasTexture, DirectionalLight, Group, Mesh, MeshStandardMaterial, NoToneMapping, OrthographicCamera, Scene, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, TextureLoader, WebGLRenderer } from 'three';
import type { Texture } from 'three';
import { COLORS, CONFIG, SIDES, isHostile } from './config';
import type { Camera, Point } from './camera';
import { isBlockaded, planets, shipsAt, units, orderUnits, unitPoint, type Game, type Order } from './game';
import { travelAim } from './movement';
import { interceptionAims } from './fleet-interception';
import { canvasViewport, dashedLine, planetPlatformOrbitRadius } from './render-geometry';
import { turnToward, SHIP_TURN_RATE } from './turning';
import { createWeaponEffects } from './visual-effects';
import { mapSegmentVisible, projectMap } from './isometric';
import { syncIsometricCamera } from './isometric-camera';
import { loadFleetModels, type FleetModelKind, type ModelInstance } from './fleet-models';
import { createSpaceLines } from './space-lines';
import { createPlanetSurface, PLANET_TERRAINS } from './planet-surfaces';
import surfaceUrl from '../docs/visual-directions/asset-proof/planet-surface.png';
import ochreUrl from '../assets/stellar-atlas/ochre-surface.png';
import mineralUrl from '../assets/stellar-atlas/mineral-surface.png';

interface RendererDependencies {
	canvas: HTMLCanvasElement;
	getState: () => { world: Game; camera: Camera; fitScale: number; highlighted: Order | undefined };
	getPixelRatio: () => number;
	getViewport: () => { width: number; height: number };
	onContextLost: () => void;
}
interface RendererInspection {
	ships: number; totalShips: number; platforms: number; travelLines: number;
	renderer: 'three'; projection: 'isometric'; contextLost: boolean;
	candidates: number; indexEntries: number; entities: number; tickerStarted: boolean;
	width: number; height: number; resolution: number; textures: number; geometries: number;
	drawCalls: number; triangles: number; batches: number; primitives: number;
}
interface SpaceRenderer {
	draw(): void;
	reset(): void;
	inspect(): RendererInspection;
	dispose(): Promise<void>;
}

// The simulation stays planar and renderer-free. This ECS owns only presentation
// entities; renderer3D supplies scene wiring, transform propagation and rendering.
export const createThreeRenderer = async function (dependencies: RendererDependencies): Promise<SpaceRenderer> {
	const renderer = new WebGLRenderer({ canvas: dependencies.canvas, antialias: true, powerPreference: 'high-performance' });
	renderer.toneMapping = NoToneMapping;
	renderer.outputColorSpace = SRGBColorSpace;
	const scene = new Scene();
	const view = new OrthographicCamera(-1, 1, 1, -1, 1, 50000);
	const ecs = ECSpresso.create().withPlugin(createRenderer3DPlugin({ renderer, scene, camera: view, startLoop: false })).build();
	const models = await loadFleetModels().catch(function (error: unknown) { renderer.dispose(); throw error; });
	const loader = new TextureLoader();
	const loaded = await Promise.allSettled([surfaceUrl, ochreUrl, mineralUrl].map(function (url) { return loader.loadAsync(url); }));
	const surfaces: Texture[] = loaded.flatMap(function (result) { return result.status === 'fulfilled' ? [result.value] : []; });
	if (loaded.some(function (result) { return result.status === 'rejected'; })) {
		for (const surface of surfaces) surface.dispose();
		models.dispose(); renderer.dispose();
		throw new Error('Planet surfaces could not load');
	}
	for (const terrain of PLANET_TERRAINS) surfaces.push(new CanvasTexture(createPlanetSurface(terrain)));
	const planetMaterials = surfaces.map(function (map) {
		map.colorSpace = SRGBColorSpace;
		map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
		return new MeshStandardMaterial({ map, roughness: 0.92, metalness: 0.05 });
	});
	const sphere = new SphereGeometry(1, 40, 28);
	const routes = createSpaceLines(0.6);
	const effects = createSpaceLines(0.95);
	const cargo = new Group();
	const badges = new Map<number, Sprite>();
	const badgeMaterials = new Map<string, SpriteMaterial>();
	const weaponEffects = createWeaponEffects();
	const globes = new Map<number, { mesh: Mesh; entityId: number }>();
	const headings = new Map<number, { angle: number; time: number }>();
	let currentWorld: Game | undefined;
	let disposal: Promise<void> | undefined;
	let disposed = false;
	let contextLost = false;
	let width = 0;
	let height = 0;
	let background: CanvasTexture | undefined;
	let counts = { ships: 0, totalShips: 0, platforms: 0, travelLines: 0 };
	const listeners = new AbortController();
	dependencies.canvas.addEventListener('webglcontextlost', function (event) {
		event.preventDefault(); contextLost = true; dependencies.onContextLost();
	}, { signal: listeners.signal });
	dependencies.canvas.addEventListener('webglcontextrestored', function () { contextLost = false; }, { signal: listeners.signal });
	const reset = function (): void {
		weaponEffects.reset(); headings.clear();
		for (const globe of globes.values()) ecs.removeEntity(globe.entityId);
		globes.clear(); cargo.clear(); badges.clear();
		for (const material of badgeMaterials.values()) { material.map?.dispose(); material.dispose(); }
		badgeMaterials.clear();
		for (const kind of ['ship', 'transport', 'carrier', 'platform'] as const) models.batch(kind, []);
		routes.clear(); routes.flush(); effects.clear(); effects.flush();
		counts = { ships: 0, totalShips: 0, platforms: 0, travelLines: 0 };
		currentWorld = undefined;
	};
	const disposeAssets = function (): void {
		listeners.abort(); models.dispose(); routes.dispose(); effects.dispose();
		sphere.dispose();
		for (const material of planetMaterials) material.dispose();
		for (const surface of surfaces) surface.dispose();
		background?.dispose(); scene.clear(); renderer.dispose();
	};
	try {
		await ecs.initialize();
		scene.add(new AmbientLight('#a4c5ef', 1.9));
		const key = new DirectionalLight('#fff0d7', 3.3); key.position.set(-800, 1300, -500); scene.add(key);
		const rim = new DirectionalLight('#75cfff', 1.5); rim.position.set(600, 200, 800); scene.add(rim);
		for (const kind of ['ship', 'transport', 'carrier', 'platform'] as const) ecs.spawn(createGroupComponents(models.batch(kind, [])));
		for (const object of [routes.object, effects.object, cargo]) scene.add(object);
	} catch (error) { await ecs.dispose().finally(disposeAssets); throw error; }
	const visible = function (point: Point, camera: Camera, margin: number): boolean {
		const projected = projectMap(point);
		const x = camera.x + projected.x * camera.scale;
		const y = camera.y + projected.y * camera.scale;
		return x >= -margin && x <= width + margin && y >= -margin && y <= height + margin;
	};
	const makeBackground = function (): void {
		const tile = document.createElement('canvas'); tile.width = width; tile.height = height;
		const context = tile.getContext('2d');
		if (!context) throw new Error('Star field requires Canvas 2D');
		context.fillStyle = '#081820'; context.fillRect(0, 0, width, height);
		for (let i = 0; i < 800; i++) {
			context.fillStyle = i % 4 === 0 ? '#738ea45c' : '#42627b55';
			context.fillRect((i * 137.57) % 2048, (i * 83.37) % 1600, i % 5 === 0 ? 1.8 : 1, i % 5 === 0 ? 1.8 : 1);
		}
		background?.dispose(); background = new CanvasTexture(tile); background.colorSpace = SRGBColorSpace;
		scene.background = background;
	};
	const cargoMaterial = function (text: string): SpriteMaterial {
		const cached = badgeMaterials.get(text); if (cached) return cached;
		const canvas = document.createElement('canvas'); canvas.width = Math.max(48, text.length * 22); canvas.height = 40;
		const context = canvas.getContext('2d'); if (!context) throw new Error('Cargo labels require Canvas 2D');
		context.fillStyle = '#10202bee'; context.fillRect(0, 0, canvas.width, 40);
		context.fillStyle = '#e7f8ff'; context.font = 'bold 28px monospace'; context.textAlign = 'center'; context.textBaseline = 'middle';
		context.fillText(text, canvas.width / 2, 20);
		const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace;
		const material = new SpriteMaterial({ map, depthTest: false }); badgeMaterials.set(text, material); return material;
	};
	const draw = function (): void {
		if (disposed || contextLost) return;
		const { world, camera, fitScale, highlighted } = dependencies.getState();
		if (world !== currentWorld) { reset(); currentWorld = world; }
		const viewport = dependencies.getViewport(); if (viewport.width <= 0 || viewport.height <= 0) return;
		const resolution = Math.min(dependencies.getPixelRatio() || 1, 2);
		if (width !== viewport.width || height !== viewport.height || renderer.getPixelRatio() !== resolution) {
			width = viewport.width; height = viewport.height;
			renderer.setPixelRatio(resolution); renderer.setSize(width, height, false); makeBackground();
		}
		const box = canvasViewport(camera, width, height);
		Object.assign(dependencies.canvas.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
		syncIsometricCamera(view, camera, width, height);
		routes.clear(); effects.clear();
		const match = world.getResource('match');
		const intercepts = interceptionAims(world);
		const instances: Record<FleetModelKind, ModelInstance[]> = { ship: [], transport: [], carrier: [], platform: [] };
		const alive = new Set<number>();
		for (const { id, components: { planet: p } } of planets(world)) {
			alive.add(id);
			if (p.carrier) instances.carrier.push({ ...p, heading: p.carrier.heading, length: p.radius * 3.6 });
			else {
				let globe = globes.get(id);
				if (!globe) {
					const variant = [...p.name].reduce(function (sum, letter) { return sum + letter.charCodeAt(0); }, 0) % planetMaterials.length;
					const mesh = new Mesh(sphere, planetMaterials[variant]);
					const entity = ecs.spawn(createMeshComponents(mesh, { x: p.x, y: 0, z: p.y }, { scale: p.radius }));
					globe = { mesh, entityId: entity.id }; globes.set(id, globe);
				}
				const transform = ecs.getComponent(globe.entityId, 'localTransform3D');
				if (transform) {
					transform.x = p.x; transform.z = p.y; transform.ry = match.time / 48 * Math.PI * 2;
					ecs.markChanged(globe.entityId, 'localTransform3D');
				}
			}
			routes.circle(p, p.radius + 20, COLORS[p.owner], 0.25);
			const platformCount = Math.max(0, Math.ceil(p.guns));
			if (platformCount > 0) routes.circle(p, planetPlatformOrbitRadius(p.radius), COLORS[p.owner], 0.3);
			for (let i = 0; i < platformCount; i++) {
				const heading = match.time * 0.12 + Math.PI * 2 * i / platformCount;
				const radius = planetPlatformOrbitRadius(p.radius);
				const point = { x: p.x + Math.cos(heading) * radius, y: p.y + Math.sin(heading) * radius };
				if (visible(point, camera, 30 * camera.scale)) instances.platform.push({ ...point, heading, owner: p.owner, length: 25 });
			}
			const orbiting = SIDES.filter(function (side) { return shipsAt(world, id, side).length > 0; });
			const hostile = orbiting.find(function (side) { return side !== p.owner; });
			if (hostile) {
				const radius = p.radius + 17;
				if (isBlockaded(world, id)) {
					for (let start = (match.time * 10) % 12 - 12; start < Math.PI * 2 * radius; start += 12)
						if (start + 6 > 0) routes.circle(p, radius, COLORS[hostile], 1, Math.max(0, start) / radius, Math.min(Math.PI * 2, (start + 6) / radius));
				} else routes.circle(p, radius, COLORS[hostile]);
			}
			if (orbiting.some(function (side) { return orbiting.some(function (other) { return isHostile(side, other); }) || (isHostile(side, p.owner) && p.guns > 0); })) {
				const angle = match.time * 4;
				effects.line({ x: p.x + Math.cos(angle) * (p.radius + 19), y: p.y + Math.sin(angle) * (p.radius + 19) },
					{ x: p.x - Math.cos(angle) * (p.radius + 19), y: p.y - Math.sin(angle) * (p.radius + 19) }, '#ffe3a9');
			}
			if (p.carrier?.destination) {
				routes.line(p, p.carrier.destination, COLORS[p.owner]); routes.circle(p.carrier.destination, 5 / camera.scale, COLORS[p.owner]);
			}
			const attack = p.carrier?.bombardment;
			const target = attack ? world.getComponent(attack.target, 'planet') : undefined;
			if (attack && target) {
				routes.line(p, target, '#ffd083', p.carrier?.destination ? 0.4 : 1);
				routes.circle(target, target.radius + 10 / camera.scale, '#ffd083', 0.7);
				if (attack.elapsed > 0) effects.circle(target, target.radius + 10 / camera.scale, '#ffd083', 1, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * attack.elapsed / CONFIG.bombardmentCharge);
			}
		}
		for (const [id, globe] of globes) if (!alive.has(id)) { ecs.removeEntity(globe.entityId); globes.delete(id); }
		if (highlighted) for (const entity of orderUnits(world, highlighted)) {
			const u = entity.components.unit; const target = world.getComponent(u.target, 'planet'); if (!target) continue;
			const point = unitPoint(u, target, match.time, entity.id, intercepts.get(entity.id));
			const aim = u.phase === 'travel' ? intercepts.get(entity.id) ?? travelAim(u, target) : target;
			for (const [from, to] of highlighted.state === 'pending' ? dashedLine(point, aim, 8 / camera.scale, 5 / camera.scale) : [[point, aim]] as const)
				routes.line(from, to, COLORS.blue);
		}
		const all = units(world).filter(function (entity) { return entity.components.unit.phase !== 'docked'; });
		const liveUnits = new Set<number>(); const cargoIds = new Set<number>(); let travelLines = 0;
		for (const { id, components: { unit: u } } of all) {
			if (u.hp <= 0) continue;
			const target = world.getComponent(u.target, 'planet'); if (!target) continue;
			liveUnits.add(id);
			const point = unitPoint(u, target, match.time, id, intercepts.get(id));
			const old = headings.get(id);
			const heading = old ? turnToward(old.angle, point.angle, SHIP_TURN_RATE, Math.max(0, match.time - old.time)) : point.angle;
			headings.set(id, { angle: heading, time: match.time });
			if (u.phase === 'travel') { routes.line(point, intercepts.get(id) ?? travelAim(u, target), COLORS[u.owner], 0.18); travelLines++; }
			if (!visible(point, camera, Math.max(40, 50 * camera.scale))) continue;
			instances[u.kind].push({ ...point, heading, owner: u.owner, length: u.kind === 'ship' ? 36 : 30 });
			const thrust = (u.phase === 'travel' ? 26 : 10) * (0.9 + 0.1 * Math.sin(match.time * 19 + id * 2.4));
			effects.line({ x: point.x - Math.cos(heading) * 12, y: point.y - Math.sin(heading) * 12 },
				{ x: point.x - Math.cos(heading) * (12 + thrust), y: point.y - Math.sin(heading) * (12 + thrust) }, COLORS[u.owner], u.phase === 'travel' ? 0.9 : 0.4);
			if (u.kind === 'transport' && camera.scale / fitScale >= 3.5) {
				cargoIds.add(id); let badge = badges.get(id);
				if (!badge) { badge = new Sprite(cargoMaterial(String(u.cargo))); cargo.add(badge); badges.set(id, badge); }
				badge.material = cargoMaterial(String(u.cargo)); badge.position.set(point.x, 16, point.y);
				badge.scale.set(Math.max(16, String(u.cargo).length * 8) / camera.scale, 14 / camera.scale, 1);
			}
		}
		for (const id of headings.keys()) if (!liveUnits.has(id)) headings.delete(id);
		for (const [id, badge] of badges) if (!cargoIds.has(id)) { cargo.remove(badge); badges.delete(id); }
		for (const shot of weaponEffects.update(match.time, match.engagements, function (shot) {
			return mapSegmentVisible({ x: shot.x1, y: shot.y1 }, { x: shot.x2, y: shot.y2 }, camera, width, height);
		})) {
			const age = match.time - shot.started; const fade = Math.max(0, 1 - age / 0.24);
			effects.line({ x: shot.x1, y: shot.y1 }, { x: shot.x2, y: shot.y2 }, COLORS[shot.owner], fade);
			const impact = { x: shot.x2, y: shot.y2 };
			effects.circle(impact, 4 + age * 32, COLORS[shot.owner], fade);
			for (let i = 0; i < 4; i++) {
				const angle = i * Math.PI / 2 + shot.started * 7; const distance = 4 + age * 35;
				effects.line({ x: impact.x + Math.cos(angle) * distance, y: impact.y + Math.sin(angle) * distance },
					{ x: impact.x + Math.cos(angle) * (distance + 5), y: impact.y + Math.sin(angle) * (distance + 5) }, '#ffe5aa', fade);
			}
		}
		for (const kind of ['ship', 'transport', 'carrier', 'platform'] as const) models.batch(kind, instances[kind], camera.scale * 36 < 45);
		routes.flush(); effects.flush();
		counts = { ships: instances.ship.length + instances.transport.length, totalShips: all.length, platforms: instances.platform.length, travelLines };
		ecs.update(0);
	};
	return {
		draw, reset,
		inspect: function (): RendererInspection { return { ...counts, renderer: 'three', projection: 'isometric', contextLost,
			candidates: counts.ships, indexEntries: 0, entities: ecs.entityCount, tickerStarted: false,
			width, height, resolution: renderer.getPixelRatio(), textures: renderer.info.memory.textures,
			geometries: renderer.info.memory.geometries, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, ...models.inspect() }; },
		dispose: function (): Promise<void> {
			if (disposal) return disposal; disposed = true; reset();
			disposal = ecs.dispose().finally(disposeAssets); return disposal;
		},
	};
};
