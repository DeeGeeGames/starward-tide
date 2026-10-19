import type { Side } from './config';
import type { StarMap } from './maps';
import { availablePoints, commitPoints, creditPoints } from './campaign-points';
import { advancePlanetPoints, changePlanetOwnership, neutralClaimMinimum as calculateNeutralClaimMinimum } from './campaign-economy';
import type { CampaignEconomyPolicy, PlanetEconomy } from './campaign-economy';
import type { PointContribution } from './campaign-points';

export interface CampaignRules {
	readonly travelSpeed: number;
	readonly minimumTravelTime: number;
	readonly rivalInterval: number;
	readonly economy: CampaignEconomyPolicy;
}
/** Smallest supported configured event interval, in galaxy seconds. */
export const MINIMUM_CAMPAIGN_EVENT_SECONDS = 0.01;

const validateTimingRules = function (rules: CampaignRules): void {
	for (const interval of [rules.minimumTravelTime, rules.rivalInterval]) {
		if (!Number.isFinite(interval) || interval < MINIMUM_CAMPAIGN_EVENT_SECONDS || interval > Number.MAX_SAFE_INTEGER)
			throw new Error(`Campaign event intervals must be at least ${MINIMUM_CAMPAIGN_EVENT_SECONDS} seconds within the safe numeric range.`);
	}
};

export const CAMPAIGN_RULES: CampaignRules = {
	travelSpeed: 10,
	minimumTravelTime: 10,
	rivalInterval: 10,
	economy: { generationPerValueSecond: 0.1, neutralClaimPointsPerValue: 5.45 },
};
export interface CampaignSystem {
	readonly id: string;
	readonly name: string;
	readonly x: number;
	readonly y: number;
	readonly map: StarMap;
}
export interface CampaignPlanet extends PlanetEconomy {
	readonly id: string;
	readonly systemId: string;
	/** Unique tactical map planet name in this system. */
	readonly name: string;
}
export interface ExpeditionOrder {
	/** Globally unique caller-supplied idempotency key, also the expedition identity. */
	readonly id: string;
	readonly factionId: Side;
	readonly sourceSystemId: string;
	readonly destinationSystemId: string;
	readonly contributions: readonly PointContribution[];
}
export interface CampaignExpedition extends ExpeditionOrder {
	readonly points: number;
	readonly departureTime: number;
	readonly arrivalTime: number;
	readonly status: 'traveling' | 'returning' | 'cancelled' | 'encounter' | 'resolved';
	readonly recalledTime?: number;
}
export interface EncounterPlanet {
	readonly planetId: string;
	readonly name: string;
	readonly factionId: Side | null;
	readonly points: number;
}
export interface CampaignEncounter {
	readonly id: string;
	readonly expeditionId: string;
	readonly systemId: string;
	readonly attacker: Side;
	readonly attackerPoints: number;
	readonly planets: readonly EncounterPlanet[];
	/** Launch-time owned-planet spending; absent in allocation and legacy battles. */
	readonly defenseCommitments?: readonly (PointContribution & { readonly originalPoints: number })[];
}
export interface CampaignEncounterResult {
	readonly encounterId: string;
	readonly captureEvents: readonly { readonly planetId: string; readonly factionId: Side }[];
	/** Complete final ownership only. Tactical units never become campaign points. */
	readonly ownership: readonly { readonly planetId: string; readonly factionId: Side | null }[];
}
export interface CampaignState {
	readonly time: number;
	readonly paused: boolean;
	readonly pace: 0.5 | 1 | 2;
	readonly nextRivalTime: number;
	readonly phase: 'galaxy' | 'encounter';
	readonly rules: CampaignRules;
	readonly systems: readonly CampaignSystem[];
	readonly planets: readonly CampaignPlanet[];
	readonly expeditions: readonly CampaignExpedition[];
	readonly encounter: CampaignEncounter | null;
	readonly resolvedEncounters: readonly CampaignEncounterResult[];
}

const compareIds = function (a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; };
const requireId = function (id: string): void { if (!id.trim()) throw new Error('Campaign identity must not be empty.'); };
const requireSide = function (side: Side): void {
	if (side !== 'blue' && side !== 'red') throw new Error('Unknown campaign faction.');
};
const sumSafePoints = function (points: readonly number[]): number {
	return points.reduce(function (total, value) {
		const sum = total + availablePoints(value);
		if (!Number.isFinite(sum) || sum > Number.MAX_SAFE_INTEGER)
			throw new Error('Campaign point total exceeds the safe numeric range.');
		return sum;
	}, 0);
};
const assertSystemPointTotals = function (planets: readonly CampaignPlanet[]): void {
	const totals = new Map<string, number>();
	for (const planet of planets) {
		const total = sumSafePoints([totals.get(planet.systemId) ?? 0, planet.points]);
		totals.set(planet.systemId, total);
	}
};
const creditPlanetBalances = function (
	planets: readonly CampaignPlanet[],
	credits: ReadonlyMap<string, number>,
	factionId: Side,
): CampaignPlanet[] {
	const updated = planets.map(function (planet) {
		const credit = credits.get(planet.id) ?? 0;
		return planet.factionId !== factionId || credit === 0 ? planet : { ...planet, points: creditPoints(planet.points, credit) };
	});
	assertSystemPointTotals(updated);
	return updated;
};
const distributeFriendlyPoints = function (
	planets: readonly CampaignPlanet[],
	systemId: string,
	factionId: Side,
	points: number,
): CampaignPlanet[] {
	const destination = planets.filter(function (planet) { return planet.systemId === systemId && planet.factionId === factionId; });
	if (destination.length === 0) throw new Error('Friendly reinforcement requires owned destination planets.');
	const largestValue = destination.reduce(function (largest, planet) { return Math.max(largest, planet.value); }, 0);
	const normalizedWeights = largestValue === 0
		? destination.map(function () { return 1; })
		: destination.map(function (planet) { return planet.value / largestValue; });
	const totalWeight = normalizedWeights.reduce(function (total, weight) { return total + weight; }, 0);
	let remaining = points;
	const credits = new Map<string, number>();
	for (const [index, planet] of destination.entries()) {
		const credit = index === destination.length - 1 ? remaining : Math.min(remaining, points * (normalizedWeights[index] ?? 0) / totalWeight);
		remaining = Math.max(0, remaining - credit);
		credits.set(planet.id, credit);
	}
	return creditPlanetBalances(planets, credits, factionId);
};

/** Neutral colonization cost scales with the combined value of the destination's planets. */
export const neutralClaimMinimum = function (state: CampaignState, systemId: string): number {
	const local = state.planets.filter(function (planet) { return planet.systemId === systemId; });
	if (!state.systems.some(function (system) { return system.id === systemId; }) || local.length === 0)
		throw new Error('Neutral claim requires a known populated system.');
	return calculateNeutralClaimMinimum(local.map(function (planet) { return planet.value; }), state.rules.economy);
};
const sameOrder = function (a: ExpeditionOrder, b: ExpeditionOrder): boolean {
	return a.factionId === b.factionId && a.sourceSystemId === b.sourceSystemId &&
		a.destinationSystemId === b.destinationSystemId && a.contributions.length === b.contributions.length &&
		a.contributions.every(function (item, index) {
			const other = b.contributions[index];
			return other !== undefined && item.planetId === other.planetId && item.points === other.points;
		});
};

export const commitExpedition = function (state: CampaignState, order: ExpeditionOrder): CampaignState {
	validateTimingRules(state.rules);
	requireId(order.id);
	requireSide(order.factionId);
	const existing = state.expeditions.find(function (item) { return item.id === order.id; });
	if (existing) {
		if (!sameOrder(existing, order)) throw new Error('Order identity was already used with different contributions.');
		return state;
	}
	if (state.phase !== 'galaxy') throw new Error('Orders are frozen during an encounter.');
	const source = state.systems.find(function (system) { return system.id === order.sourceSystemId; });
	const destination = state.systems.find(function (system) { return system.id === order.destinationSystemId; });
	if (!source || !destination || source.id === destination.id) throw new Error('An expedition requires distinct known systems.');
	if (!Number.isFinite(state.rules.travelSpeed) || state.rules.travelSpeed <= 0) throw new Error('Travel speed must be positive.');
	const travelTime = Math.max(state.rules.minimumTravelTime, Math.hypot(destination.x - source.x, destination.y - source.y) / state.rules.travelSpeed);
	const arrivalTime = state.time + travelTime;
	if (!Number.isFinite(arrivalTime) || arrivalTime > Number.MAX_SAFE_INTEGER || arrivalTime <= state.time) throw new Error('Invalid expedition arrival time.');
	const committed = commitPoints(state.planets.map(function (planet) {
		return { planetId: planet.id, systemId: planet.systemId, factionId: planet.factionId,
			points: planet.points };
	}), source.id, order.factionId, order.contributions);
	if (committed.totalPoints === 0) throw new Error('An expedition must commit points.');
	const destinationPlanets = state.planets.filter(function (planet) { return planet.systemId === destination.id; });
	if (destinationPlanets.length > 0 && destinationPlanets.every(function (planet) { return planet.factionId === null; }) &&
		committed.totalPoints < neutralClaimMinimum(state, destination.id))
		throw new Error('The expedition does not meet the unclaimed system commitment minimum.');
	const debits = new Map(committed.balances.map(function (balance) { return [balance.planetId, balance.points] as const; }));
	const expedition: CampaignExpedition = { ...order, contributions: committed.debits, points: committed.totalPoints,
		departureTime: state.time, arrivalTime, status: 'traveling' };
	return { ...state, planets: state.planets.map(function (planet) {
		const points = debits.get(planet.id);
		if (points === undefined) throw new Error('Missing committed planetary balance.');
		return { ...planet, points };
	}), expeditions: [...state.expeditions, expedition] };
};

export const isActiveExpedition = function (expedition: CampaignExpedition): boolean {
	return expedition.status !== 'resolved' && expedition.status !== 'cancelled';
};
export const activePlayerExpeditions = function (state: CampaignState): CampaignExpedition[] {
	return state.expeditions.filter(function (expedition) {
		return expedition.factionId === 'blue' && isActiveExpedition(expedition);
	});
};
export const expeditionArrival = function (expedition: CampaignExpedition): number {
	return expedition.recalledTime === undefined ? expedition.arrivalTime : 2 * expedition.recalledTime - expedition.departureTime;
};
export const canCancelExpedition = function (state: CampaignState, expedition: CampaignExpedition, factionId: Side): boolean {
	return state.phase === 'galaxy' &&
		expedition.factionId === factionId && expedition.status === 'traveling';
};

/** Cancellation at departure refunds immediately; recall takes elapsed outbound time to return. */
export const cancelExpedition = function (state: CampaignState, id: string, factionId: Side): CampaignState {
	requireSide(factionId);
	const expedition = state.expeditions.find(function (item) { return item.id === id; });
	if (!expedition || !canCancelExpedition(state, expedition, factionId)) return state;
	const cancelled = expedition.departureTime === state.time;
	const recalledTime = cancelled ? undefined : state.time;
	if (recalledTime !== undefined && (!Number.isFinite(2 * recalledTime - expedition.departureTime) || 2 * recalledTime - expedition.departureTime > Number.MAX_SAFE_INTEGER))
		throw new Error('Recall exceeds the galaxy time limit.');
	const refunds = new Map(expedition.contributions.map(function (entry) { return [entry.planetId, entry.points] as const; }));
	return { ...state,
		planets: cancelled ? creditPlanetBalances(state.planets, refunds, factionId) : state.planets,
		expeditions: state.expeditions.map(function (item) {
			return item.id !== id ? item : cancelled ? { ...item, status: 'cancelled' as const } : { ...item, status: 'returning' as const, recalledTime };
		}),
	};
};

const resolveArrivals = function (initial: CampaignState): CampaignState {
	let state = initial;
	const due = state.expeditions.filter(function (item) { return (item.status === 'traveling' || item.status === 'returning') && expeditionArrival(item) <= state.time; })
		.toSorted(function (a, b) { return expeditionArrival(a) - expeditionArrival(b) || compareIds(a.id, b.id); });
	for (const expedition of due) {
		if (expedition.status === 'returning') {
			const refunds = new Map(expedition.contributions.map(function (entry) { return [entry.planetId, entry.points] as const; }));
			state = { ...state, planets: creditPlanetBalances(state.planets, refunds, expedition.factionId), expeditions: state.expeditions.map(function (item) {
				return item.id === expedition.id ? { ...item, status: 'resolved' as const } : item;
			}) };
			continue;
		}
		const destination = state.planets.filter(function (planet) { return planet.systemId === expedition.destinationSystemId; });
		if (destination.length === 0) throw new Error('Destination system has no planets.');
		if (destination.every(function (planet) { return planet.factionId === null; })) {
			const qualifies = expedition.points >= neutralClaimMinimum(state, expedition.destinationSystemId);
			state = { ...state,
				planets: qualifies ? state.planets.map(function (planet) {
						return planet.systemId !== expedition.destinationSystemId ? planet : changePlanetOwnership(planet, expedition.factionId);
				}) : state.planets,
				expeditions: state.expeditions.map(function (item) {
					return item.id === expedition.id ? { ...item, status: 'resolved' as const } : item;
				}),
			};
			continue;
		}
		if (destination.every(function (planet) { return planet.factionId === null || planet.factionId === expedition.factionId; })) {
			state = { ...state, planets: distributeFriendlyPoints(state.planets, expedition.destinationSystemId,
				expedition.factionId, expedition.points), expeditions: state.expeditions.map(function (item) {
				return item.id === expedition.id ? { ...item, status: 'resolved' as const } : item;
			}) };
			continue;
		}
		const encounter: CampaignEncounter = { id: `encounter:${expedition.id}`, expeditionId: expedition.id,
			systemId: expedition.destinationSystemId, attacker: expedition.factionId, attackerPoints: expedition.points,
			planets: destination.map(function (planet) {
				return { planetId: planet.id, name: planet.name, factionId: planet.factionId, points: availablePoints(planet.points) };
			}) };
		return { ...state, phase: 'encounter', encounter, expeditions: state.expeditions.map(function (item) {
			return item.id === expedition.id ? { ...item, status: 'encounter' as const } : item;
		}) };
	}
	return { ...state, phase: 'galaxy', encounter: null };
};

export const setCampaignPaused = function (state: CampaignState, paused: boolean): CampaignState {
	if (state.phase === 'encounter' && !paused) return state;
	return state.paused === paused ? state : { ...state, paused };
};

/** Advance to each event in order and discard the remaining frame when combat interrupts. */
export const advanceCampaign = function (initial: CampaignState, elapsedSeconds: number): CampaignState {
	validateTimingRules(initial.rules);
	if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0)
		throw new Error('Galaxy duration must be finite and nonnegative.');
	if (initial.paused || initial.phase === 'encounter' || campaignWinner(initial) !== null || elapsedSeconds === 0) return initial;
	const target = initial.time + elapsedSeconds;
	if (!Number.isFinite(target) || target > Number.MAX_SAFE_INTEGER) throw new Error('Galaxy time limit reached.');
	if (!Number.isFinite(initial.nextRivalTime) || initial.nextRivalTime < initial.time)
		throw new Error('Invalid rival decision cadence.');
	let state = initial;
	while (state.time < target) {
		const arrival = state.expeditions.reduce(function (earliest, item) {
			return item.status === 'traveling' || item.status === 'returning' ? Math.min(earliest, expeditionArrival(item)) : earliest;
		}, Infinity);
		if (arrival < state.time) throw new Error('An active expedition cannot arrive in the past.');
		const time = Math.min(target, arrival, state.nextRivalTime);
		const elapsed = time - state.time;
		const planets = state.planets.map(function (planet) { return advancePlanetPoints(planet, elapsed, state.rules.economy); });
		assertSystemPointTotals(planets);
		state = { ...state, time, planets };
		state = resolveArrivals(state);
		if (state.phase === 'encounter') return { ...state, paused: true };
		if (campaignWinner(state) !== null) return { ...state, paused: true };
		if (state.nextRivalTime === time) {
			state = commitCampaignRival(state);
			const nextRivalTime = time + state.rules.rivalInterval;
			if (!Number.isFinite(nextRivalTime) || nextRivalTime <= time || nextRivalTime > Number.MAX_SAFE_INTEGER)
				throw new Error('Rival decision clock limit reached.');
			state = { ...state, nextRivalTime };
		}
	}
	return state;
};

export const applyCampaignEncounterResult = function (state: CampaignState, result: CampaignEncounterResult): CampaignState {
	const prior = state.resolvedEncounters.find(function (item) { return item.encounterId === result.encounterId; });
	if (prior) {
		const sameCaptures = prior.captureEvents.length === result.captureEvents.length && prior.captureEvents.every(function (event, index) {
			const other = result.captureEvents[index];
			return other !== undefined && event.planetId === other.planetId && event.factionId === other.factionId;
		});
		const sameOwnership = prior.ownership.length === result.ownership.length && prior.ownership.every(function (item) {
			return result.ownership.filter(function (other) { return other.planetId === item.planetId && other.factionId === item.factionId; }).length === 1;
		});
		if (!sameCaptures || !sameOwnership) throw new Error('Encounter result identity was reused with a different outcome.');
		return state;
	}
	const encounter = state.encounter;
	if (state.phase !== 'encounter' || !encounter || encounter.id !== result.encounterId)
		throw new Error('Encounter result does not match the active encounter.');
	const ownership = new Map<string, Side | null>();
	for (const item of result.ownership) {
		if (item.factionId !== null) requireSide(item.factionId);
		if (ownership.has(item.planetId) || !encounter.planets.some(function (planet) { return planet.planetId === item.planetId; }))
			throw new Error('Encounter ownership must identify each destination planet once.');
		ownership.set(item.planetId, item.factionId);
	}
	if (ownership.size !== encounter.planets.length) throw new Error('Encounter outcome is missing planetary ownership.');
	let planets = state.planets;
	for (const event of result.captureEvents) {
		requireSide(event.factionId);
		if (!ownership.has(event.planetId)) throw new Error('Capture event identifies an unknown destination planet.');
		const captured = planets.find(function (planet) { return planet.id === event.planetId; });
		if (!captured || captured.factionId === event.factionId) throw new Error('Capture events must change actual ownership.');
		planets = planets.map(function (planet) {
			return planet.id !== event.planetId ? planet : changePlanetOwnership(planet, event.factionId);
		});
	}
	if (planets.some(function (planet) { return ownership.has(planet.id) && ownership.get(planet.id) !== planet.factionId; }))
		throw new Error('Final ownership does not match the ordered capture events.');
	return resolveArrivals({ ...state, planets, phase: 'galaxy', paused: true, encounter: null,
		expeditions: state.expeditions.map(function (item) {
			return item.id === encounter.expeditionId ? { ...item, status: 'resolved' as const } : item;
		}), resolvedEncounters: [...state.resolvedEncounters, structuredClone(result)] });
};

/** Commit at most one rival expedition. Retry identity and source spending live in the domain. */
export const commitCampaignRival = function (state: CampaignState): CampaignState {
	validateTimingRules(state.rules);
	const id = `rival:${state.nextRivalTime}`;
	if (state.phase !== 'galaxy' || state.expeditions.some(function (item) { return item.id === id; })) return state;
	const routes = state.systems.flatMap(function (source) {
		const local = state.planets.filter(function (planet) { return planet.systemId === source.id; });
		const owned = local.filter(function (planet) { return planet.factionId === 'red'; });
		if (owned.length === 0) return [];
		const available = sumSafePoints(owned.map(function (planet) { return availablePoints(planet.points); }));
		if (Math.floor(available / 2) === 0) return [];
		return state.systems.filter(function (destination) {
			if (destination.id === source.id) return false;
			const local = state.planets.filter(function (planet) { return planet.systemId === destination.id; });
			const unclaimed = local.length > 0 && local.every(function (planet) { return planet.factionId === null; });
			const hostile = local.some(function (planet) { return planet.factionId === 'blue'; });
			return unclaimed || hostile;
		}).map(function (destination) {
			return { source, destination, owned, budget: Math.floor(available / 2), distance: Math.hypot(destination.x - source.x, destination.y - source.y) };
		});
	}).toSorted(function (a, b) {
		return a.distance - b.distance || compareIds(a.source.id, b.source.id) || compareIds(a.destination.id, b.destination.id);
	});
	for (const route of routes) {
		let remaining = route.budget;
		const contributions = route.owned.toSorted(function (a, b) { return compareIds(a.id, b.id); }).flatMap(function (planet) {
			const points = Math.min(remaining, Math.floor(availablePoints(planet.points)));
			remaining -= points;
			return points > 0 ? [{ planetId: planet.id, points }] : [];
		});
		if (contributions.length === 0) continue;
		if (state.planets.filter(function (planet) { return planet.systemId === route.destination.id; })
			.every(function (planet) { return planet.factionId === null; }) &&
			contributions.reduce(function (total, contribution) { return total + contribution.points; }, 0) < neutralClaimMinimum(state, route.destination.id)) continue;
		return commitExpedition(state, { id, factionId: 'red', sourceSystemId: route.source.id,
			destinationSystemId: route.destination.id, contributions });
	}
	return state;
};

/** Wait until every due arrival resolves before declaring victory; in-flight relief keeps a faction alive. */
export const campaignWinner = function (state: CampaignState): Side | null {
	if (state.phase !== 'galaxy') return null;
	const alive = function (factionId: Side): boolean {
		return state.planets.some(function (planet) { return planet.factionId === factionId; }) ||
			state.expeditions.some(function (item) { return item.factionId === factionId && isActiveExpedition(item); });
	};
	const blue = alive('blue');
	const red = alive('red');
	return blue && !red ? 'blue' : red && !blue ? 'red' : null;
};
