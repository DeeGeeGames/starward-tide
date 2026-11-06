import { expect, test } from 'bun:test';
import { assessInvasion, productionEstimate, type TacticalSource } from './tactical-advisor';
import type { Planet } from './game';

const target: Planet = { name: 'Sol', x: 300, y: 0, radius: 28, owner: 'red', troops: 10, guns: 0, rate: 2.6, production: 'troops', progress: 0 };
const source = function (troops: number, ships: number): TacticalSource {
	return { id: 1, planet: { x: 0, y: 0 }, preview: { troops, ships, blockedSources: 0 } };
};

test('advisor never presents a ships-only or tied invasion as a surface capture', function () {
	const fleet = assessInvasion({ target: { id: 2, planet: target }, sources: [source(0, 100)], hostileShips: 0 });
	expect(fleet.title).toBe('Ships cannot capture');
	expect(fleet.troopArrivalSeconds).toBeNull();
	const tied = assessInvasion({ target: { id: 2, planet: target }, sources: [source(10, 3)], hostileShips: 0 });
	expect(tied.title).toBe('More troops needed');
	expect(tied.detail).toContain('At least 11');
});

test('orbital defense blocks even superior transport forces, but neutral platforms do not', function () {
	const invasion = source(100, 0);
	const defended = assessInvasion({ target: { id: 2, planet: { ...target, guns: 0.2 } }, sources: [invasion], hostileShips: 0 });
	expect(defended.title).toBe('Landing blocked');
	expect(defended.hostilePlatforms).toBe(1);
	expect(defended.detail).toContain('no escorts');
	const neutral = assessInvasion({ target: { id: 2, planet: { ...target, owner: 'neutral', guns: 4 } }, sources: [invasion], hostileShips: 0 });
	expect(neutral.hostilePlatforms).toBe(0);
	expect(neutral.title).toBe('Surface advantage');
	const hostileOrbit = assessInvasion({ target: { id: 2, planet: { ...target, owner: 'blue' } }, sources: [invasion], hostileShips: 2 });
	expect(hostileOrbit.title).toBe('Landing blocked');
});

test('arrival estimates preserve slow transports, exclude local stock, and do not promise moving-carrier arrival', function () {
	const local = { ...source(1000, 1000), id: 2 };
	const estimate = assessInvasion({ target: { id: 2, planet: target }, sources: [source(20, 3), local, source(20, 3)], hostileShips: 0 });
	expect(estimate.troops).toBe(20);
	expect(estimate.ships).toBe(3);
	const ships = estimate.shipArrivalSeconds;
	const transports = estimate.troopArrivalSeconds;
	if (!ships || !transports) throw new Error('Expected both force arrival estimates');
	expect(transports.latest).toBeCloseTo(ships.latest * 2);
	const moving = assessInvasion({ target: { id: 2, planet: { ...target, carrier: { destination: { x: 500, y: 0 }, heading: 0 } } }, sources: [source(20, 3)], hostileShips: 0 });
	expect(moving.shipArrivalSeconds).toBeNull();
	expect(moving.troopArrivalSeconds).toBeNull();
});

test('inactive or neutral production never advertises a completion countdown', function () {
	expect(productionEstimate({ ...target, rate: 0 }).secondsRemaining).toBeNull();
	expect(productionEstimate({ ...target, owner: 'neutral' }).secondsRemaining).toBeNull();
	expect(productionEstimate({ ...target, rate: Number.NaN }).secondsRemaining).toBeNull();
});
