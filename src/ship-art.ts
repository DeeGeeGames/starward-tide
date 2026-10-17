import { COLORS, type Side } from './config';

// Original Canvas paths are rasterized once per side/kind/detail tier.
export const createShipPainter = function (ctx: CanvasRenderingContext2D): {
	warship: (owner: Side, zoom: number) => void;
	transport: (owner: Side, zoom: number) => void;
} {
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
		zoom: number,
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
	};
	return { warship: drawWarship, transport: drawTroopTransport };
};
