import type { Side } from './config';
import type { CampaignEncounterResult, CampaignPlanet, CampaignState } from './campaign-state';
import { expeditionArrival, neutralClaimMinimum } from './campaign-state';
import { changePlanetOwnership } from './campaign-economy';

export interface CampaignPlanetReport {
	readonly planetId: string;
	readonly systemId: string;
	readonly name: string;
	readonly factionId: Side | null;
	readonly value: number;
	readonly availablePoints: number;
}
export interface CampaignPlanetChange {
	readonly before: CampaignPlanetReport;
	readonly after: CampaignPlanetReport;
}
export interface CampaignEncounterOutcome {
	readonly encounterId: string;
	readonly systemId: string;
	readonly systemName: string;
	readonly expeditionId: string;
	readonly attacker: Side;
	readonly winner: Side;
	readonly attackerPoints: number;
	readonly planets: readonly CampaignPlanetChange[];
}
export interface CampaignResolvedExpedition {
	readonly expeditionId: string;
	readonly systemId: string;
	readonly factionId: Side;
	readonly points: number;
	readonly kind: 'claim' | 'friendly' | 'encounter' | 'resolved' | 'return';
}
export interface CampaignTransitionReport {
	readonly fromTime: number;
	readonly toTime: number;
	readonly timeAdvanced: boolean;
	readonly phase: CampaignState['phase'];
	readonly focusSystemId: string | undefined;
	readonly planets: readonly CampaignPlanetChange[];
	readonly resolvedExpeditions: readonly CampaignResolvedExpedition[];
	readonly outcome?: CampaignEncounterOutcome;
}

const snapshot = function (planet: CampaignPlanet): CampaignPlanetReport {
	return { planetId: planet.id, systemId: planet.systemId, name: planet.name, factionId: planet.factionId,
		value: planet.value, availablePoints: planet.points };
};

/** Battle consequences only: later arrivals have not happened. */
export const describeEncounterOutcome = function (
	state: CampaignState,
	result: CampaignEncounterResult,
	winner: Side,
): CampaignEncounterOutcome {
	const encounter = state.encounter;
	if (state.phase !== 'encounter' || !encounter || encounter.id !== result.encounterId)
		throw new Error('Outcome must describe the active encounter.');
	if (winner !== 'blue' && winner !== 'red') throw new Error('Outcome requires a faction winner.');
	const system = state.systems.find(function (item) { return item.id === encounter.systemId; });
	const expedition = state.expeditions.find(function (item) { return item.id === encounter.expeditionId; });
	if (!system || !expedition) throw new Error('Outcome is missing its system or expedition.');
	const originals = state.planets.filter(function (planet) { return planet.systemId === encounter.systemId; });
	const planets = new Map(originals.map(function (planet) { return [planet.id, planet] as const; }));
	for (const event of result.captureEvents) {
		const planet = planets.get(event.planetId);
		if (!planet || planet.factionId === event.factionId || (event.factionId !== 'blue' && event.factionId !== 'red'))
			throw new Error('Outcome capture events must change ownership of a known encounter planet.');
		planets.set(planet.id, changePlanetOwnership(planet, event.factionId));
	}
	const ownership = new Map(result.ownership.map(function (item) { return [item.planetId, item.factionId] as const; }));
	if (ownership.size !== result.ownership.length || ownership.size !== originals.length ||
		originals.some(function (planet) { return !ownership.has(planet.id) || ownership.get(planet.id) !== planets.get(planet.id)?.factionId; }))
		throw new Error('Outcome ownership must match its chronological captures.');
	return { encounterId: encounter.id, systemId: system.id, systemName: system.name, expeditionId: expedition.id,
		attacker: encounter.attacker, winner, attackerPoints: encounter.attackerPoints,
		planets: originals.map(function (planet) {
			const after = planets.get(planet.id);
			if (!after) throw new Error('Outcome planet is missing.');
			return { before: snapshot(planet), after: snapshot(after) };
		}) };
};

/** Session feedback, derived from authoritative before/after states without mutation. */
export const describeCampaignTransition = function (
	before: CampaignState,
	after: CampaignState,
	outcome?: CampaignEncounterOutcome,
): CampaignTransitionReport {
	const oldPlanets = new Map(before.planets.map(function (planet) { return [planet.id, planet] as const; }));
	const planets = after.planets.map(function (planet): CampaignPlanetChange {
		const original = oldPlanets.get(planet.id);
		if (!original) throw new Error('Transition planet did not exist before resolution.');
		return { before: snapshot(original), after: snapshot(planet) };
	});
	const ownership = new Map(before.planets.map(function (planet) { return [planet.id, planet.factionId] as const; }));
	const previouslyResolved = new Set(before.expeditions.filter(function (item) { return item.status === 'resolved'; }).map(function (item) { return item.id; }));
	const resolved = after.expeditions.filter(function (item) { return item.status === 'resolved' && !previouslyResolved.has(item.id); })
		.toSorted(function (a, b) { return expeditionArrival(a) - expeditionArrival(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
	const resolvedExpeditions = resolved.map(function (expedition): CampaignResolvedExpedition {
		if (expedition.recalledTime !== undefined) return { expeditionId: expedition.id, systemId: expedition.sourceSystemId,
			factionId: expedition.factionId, points: expedition.points, kind: 'return' };
		const result = after.resolvedEncounters.find(function (item) { return item.encounterId === `encounter:${expedition.id}`; });
		const local = before.planets.filter(function (planet) { return planet.systemId === expedition.destinationSystemId; });
		let kind: CampaignResolvedExpedition['kind'] = 'resolved';
		if (result) {
			kind = 'encounter';
			for (const planet of result.ownership) ownership.set(planet.planetId, planet.factionId);
		} else if (local.length > 0 && local.every(function (planet) { return ownership.get(planet.id) === expedition.factionId; })) kind = 'friendly';
		else if (local.length > 0 && local.every(function (planet) { return ownership.get(planet.id) === null; }) &&
			expedition.points >= neutralClaimMinimum(before, expedition.destinationSystemId)) {
			kind = 'claim';
			for (const planet of local) ownership.set(planet.id, expedition.factionId);
		}
		return { expeditionId: expedition.id, systemId: expedition.destinationSystemId, factionId: expedition.factionId,
			points: expedition.points, kind };
	});
	return { fromTime: before.time, toTime: after.time, timeAdvanced: after.time > before.time, phase: after.phase,
		focusSystemId: outcome?.systemId ?? after.encounter?.systemId ?? resolvedExpeditions[0]?.systemId,
		planets, resolvedExpeditions, ...(outcome ? { outcome } : {}) };
};
