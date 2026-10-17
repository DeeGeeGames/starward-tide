import { COLORS } from './config';
import type { Side } from './config';
import type { Camera } from './camera';
import type { StarMap } from './maps';
import { isBlockaded, planets, shipsAt, orderUnits, unitPoint, units } from './game';
import type { Game, Order } from './game';

interface RendererState {
	world: Game;
	map: StarMap;
	camera: Camera;
	fitScale: number;
	highlighted: Order | undefined;
}
interface RendererDependencies {
	canvas: HTMLCanvasElement;
	getState: () => RendererState;
	getPixelRatio: () => number;
}

// Reads a fresh session snapshot each frame; owns no animation loop or world.
export const createCanvasRenderer = function (dependencies: RendererDependencies): {
	draw: () => void;
	dispose: () => void;
} {
	const { canvas } = dependencies;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D is required');
	let disposed = false;
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
	const draw = function (): void {
		if (disposed) return;
		const { world, map: activeMap, camera, fitScale, highlighted } = dependencies.getState();
		const { width, height } = activeMap;
		const dpr = Math.min((dependencies.getPixelRatio() || 1) * Math.max(1, camera.scale), 3);
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

	return {
		draw,
		dispose: function (): void {
			disposed = true;
		},
	};
};
