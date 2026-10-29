export const SHIP_TURN_RATE = Math.PI;
export const CARRIER_TURN_RATE = Math.PI / 18;

// Radians per simulation second; keep angles continuous across the wrap boundary.
export const turnToward = function (heading: number, target: number, rate: number, dt: number): number {
	const difference = Math.atan2(Math.sin(target - heading), Math.cos(target - heading));
	const step = rate * Math.max(0, dt);
	return heading + Math.max(-step, Math.min(step, difference));
};
