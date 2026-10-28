import type { Owner, Side } from './config';
import type { Point } from './camera';
import { carrierSeeds, type StarMap } from './maps';

export const GAME_MODES = {
	conquest: { label: 'Conquest', detail: 'Capture every rival world and carrier.' },
	'center-race': { label: 'Center race', detail: 'Reach the shared destination near the middle with a carrier before your rival.' },
	'crossing-race': { label: 'Crossing race', detail: 'Get a carrier to your destination near the rival start. Stop their carrier from reaching theirs.' },
} as const;
export type GameMode = keyof typeof GAME_MODES;
export const isGameMode = function (value: string): value is GameMode {
	return Object.hasOwn(GAME_MODES, value);
};
export interface Destination extends Point {
	readonly owner: Owner;
	readonly label: string;
	readonly radius: number;
}
export interface Arrival {
	readonly carrierId: number;
	readonly owner: Side;
	readonly fraction: number;
}
export interface Objectives {
	readonly mode: GameMode;
	readonly destinations: readonly Destination[];
	arrivals: Arrival[];
}
export const DESTINATION_RADIUS = 42;

// Destinations are derived from immutable map seeds, so restarts and old saves
// need no extra mutable objective state. Keep their whole zone clear of hit areas.
export const raceDestinations = function (map: StarMap): readonly Destination[] {
	if (!map.mode || map.mode === 'conquest') return [];
	const carriers = carrierSeeds(map);
	const blue = carriers.find(function (seed) { return seed[4] === 'blue'; });
	const red = carriers.find(function (seed) { return seed[4] === 'red'; });
	if (!blue || !red) return [];
	const clear = function (point: Point): boolean {
		const margin = DESTINATION_RADIUS + 12;
		return point.x >= margin && point.y >= margin && point.x <= map.width - margin && point.y <= map.height - margin &&
			[...map.planets, ...carriers].every(function (seed) {
				return Math.hypot(point.x - seed[1], point.y - seed[2]) >= DESTINATION_RADIUS + seed[3] + 44;
			});
	};
	const make = function (point: Point, owner: Owner, label: string): Destination {
		return { ...point, owner, label, radius: DESTINATION_RADIUS };
	};
	const center = { x: (blue[1] + red[1]) / 2, y: (blue[2] + red[2]) / 2 };
	if (map.mode === 'center-race') {
		// The perpendicular bisector gives both starting carriers equal distance.
		const distance = Math.hypot(red[1] - blue[1], red[2] - blue[2]);
		if (distance === 0) return [];
		const limit = Math.hypot(map.width, map.height);
		for (let offset = 0; offset <= limit; offset += 12) {
			for (const sign of [1, -1]) {
				const point = { x: center.x - (red[2] - blue[2]) / distance * offset * sign, y: center.y + (red[1] - blue[1]) / distance * offset * sign };
				if (clear(point)) return [make(point, 'neutral', 'Shared destination')];
			}
		}
		return [];
	}
	// Search mirrored pairs near the opposing starts, keeping travel symmetric.
	// Reflection about the carrier midpoint also supports the authored lab map.
	const candidates: Point[] = [];
	for (let x = 60; x <= map.width - 60; x += 24) {
		for (let y = 60; y <= map.height - 60; y += 24) candidates.push({ x, y });
	}
	candidates.sort(function (a, b) {
		return Math.hypot(a.x - red[1], a.y - red[2]) - Math.hypot(b.x - red[1], b.y - red[2]);
	});
	for (const point of candidates) {
		const mirrored = { x: center.x * 2 - point.x, y: center.y * 2 - point.y };
		if (Math.hypot(point.x - red[1], point.y - red[2]) >= Math.hypot(point.x - blue[1], point.y - blue[2])) continue;
		if (Math.hypot(point.x - mirrored.x, point.y - mirrored.y) < DESTINATION_RADIUS * 2 + 24) continue;
		if (clear(point) && clear(mirrored)) return [make(point, 'blue', 'Your destination'), make(mirrored, 'red', 'Rival destination')];
	}
	return [];
};

export const destinationFor = function (objectives: Objectives, side: Side): Destination | undefined {
	return objectives.destinations.find(function (destination) { return destination.owner === 'neutral' || destination.owner === side; });
};

// Fraction of this simulation step at which the carrier center first enters the
// zone. Sweeping avoids missed fly-throughs and resolves close finishes by time.
export const arrivalFraction = function (from: Point, to: Point, destination: Destination): number | undefined {
	const x = from.x - destination.x, y = from.y - destination.y;
	const c = x * x + y * y - destination.radius * destination.radius;
	if (c <= 0) return 0;
	const dx = to.x - from.x, dy = to.y - from.y;
	const a = dx * dx + dy * dy;
	if (a === 0) return undefined;
	const b = 2 * (x * dx + y * dy);
	const discriminant = b * b - 4 * a * c;
	if (discriminant < 0) return undefined;
	const fraction = (-b - Math.sqrt(discriminant)) / (2 * a);
	return fraction >= 0 && fraction <= 1 ? fraction : undefined;
};
