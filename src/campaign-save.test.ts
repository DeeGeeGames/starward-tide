import { expect, test } from 'bun:test';
import { campaignBattleLaunchState } from './campaign-launch';
import { campaignStateSchema, parseCampaignSave, isSupportedCampaignSave } from './campaign-save';
import type { CampaignSave } from './campaign-save';
import { CAMPAIGN_RULES, MINIMUM_CAMPAIGN_EVENT_SECONDS, cancelExpedition, applyCampaignEncounterResult, commitExpedition, advanceCampaign, setCampaignPaused } from './campaign-state';
import type { CampaignState } from './campaign-state';
import { InvalidSaveError } from './save-state';
import { commitEncounterDefenses, createDefaultEncounterSetup } from './campaign-setup';
import { createCampaignBattle } from './campaign-encounter';
import { captureConquestSave } from './game-save';
import { units } from './game';

const makeSave = function (): CampaignSave {
	const map = { width: 100, height: 100, planets: [
		['One', 20, 20, 10, 'blue', 0, 1] as const, ['Two', 70, 70, 10, 'red', 0, 1] as const,
	] };
	const campaign: CampaignState = { time: 0, paused: true, pace: 1, nextRivalTime: 10, phase: 'galaxy', rules: CAMPAIGN_RULES,
		systems: [{ id: 'home', name: 'Home', x: 0, y: 0, map }, { id: 'away', name: 'Away', x: 100, y: 0, map }],
		planets: ['home', 'away'].flatMap(function (systemId) {
			return ['One', 'Two'].map(function (name) {
				return { id: `${systemId}:${name}`, systemId, name, factionId: systemId === 'home' ? 'blue' as const : 'red' as const,
					baselinePoints: 100, developmentBonusPoints: 0, depletion: 0, capturedTime: null, lastAppliedTime: 0 };
			});
		}), expeditions: [], encounter: null, resolvedEncounters: [] };
	return { schemaVersion: 2, mode: 'campaign', profileId: 'profile', savedAt: 100, campaign };
};
const startEncounter = function (save: CampaignSave): CampaignSave {
	const state = commitExpedition(save.campaign, { id: 'first', factionId: 'blue', sourceSystemId: 'home', destinationSystemId: 'away',
		contributions: [{ planetId: 'home:One', points: 40 }] });
	return { ...save, campaign: advanceCampaign(setCampaignPaused(state, false), 10) };
};

test('paused, running, active encounter and resolved campaign saves round-trip without spending twice', function () {
	const initial = makeSave();
	expect(parseCampaignSave(initial, 'profile')).toEqual(initial);
	const active = startEncounter(initial);
	expect(active.campaign.phase).toBe('encounter');
	const restored = parseCampaignSave(active);
	expect(restored).toEqual(active);
	expect(restored.campaign.planets.find(function (planet) { return planet.id === 'home:One'; })?.depletion).toBeCloseTo(29.9);
	const result = { encounterId: 'encounter:first', captureEvents: [], ownership: [
		{ planetId: 'away:One', factionId: 'red' as const }, { planetId: 'away:Two', factionId: 'red' as const },
	] };
	const resolved = { ...active, campaign: applyCampaignEncounterResult(restored.campaign, result) };
	expect(parseCampaignSave(resolved)).toEqual(resolved);
	expect(applyCampaignEncounterResult(parseCampaignSave(resolved).campaign, result)).toEqual(resolved.campaign);
});

test('campaign saves reject unsupported versions, wrong modes/profiles and unrecognized tactical formats', function () {
	const valid = makeSave();
	for (const input of [null, {}, { ...valid, schemaVersion: 1 }, { ...valid, schemaVersion: 3 }, { ...valid, mode: 'skirmish' },
		{ ...valid, tactical: { unsupported: true } }, { ...valid, savedAt: Infinity }]) {
		expect(isSupportedCampaignSave(input)).toBe(false);
		expect(function () { parseCampaignSave(input); }).toThrow(InvalidSaveError);
	}
	expect(function () { parseCampaignSave(valid, 'other'); }).toThrow(InvalidSaveError);
});

test('campaign validation rejects broken identities, budgets, phase and clock records', function () {
	const active = startEncounter(makeSave());
	const state = active.campaign;
	const firstPlanet = state.planets[0];
	const firstOrder = state.expeditions[0];
	if (!firstPlanet || !firstOrder || !state.encounter) throw new Error('Missing fixture entities');
	const invalidStates = [
		{ ...state, planets: [...state.planets, firstPlanet] },
		{ ...state, paused: false },
		{ ...state, nextRivalTime: 9 },
		{ ...state, phase: 'galaxy' },
		{ ...state, encounter: null },
		{ ...state, planets: [{ ...firstPlanet, lastAppliedTime: state.time - 1 }, ...state.planets.slice(1)] },
		{ ...state, planets: [{ ...firstPlanet, developmentBonusPoints: 99 }, ...state.planets.slice(1)] },
		{ ...state, expeditions: [{ ...firstOrder, points: 41 }] },
		{ ...state, expeditions: [{ ...firstOrder, arrivalTime: 2 }] },
		{ ...state, expeditions: [{ ...firstOrder, contributions: [{ planetId: 'away:One', points: 40 }] }] },
		{ ...state, encounter: { ...state.encounter, attackerPoints: 39 } },
		{ ...state, encounter: { ...state.encounter, planets: state.encounter.planets.map(function (planet) { return { ...planet, points: 999 }; }) } },
		{ ...state, resolvedEncounters: [{ encounterId: state.encounter.id, captureEvents: [], ownership: [{ planetId: 'away:One', factionId: 'red' }] }] },
	];
	for (const campaign of invalidStates) expect(isSupportedCampaignSave({ ...active, campaign })).toBe(false);
});

test('excess absolute depletion remains supported after maximum capacity drops', function () {
	const save = makeSave();
	const depleted = { ...save, campaign: { ...save.campaign, planets: save.campaign.planets.map(function (planet) {
		return { ...planet, depletion: 150 };
	}) } };
	expect(parseCampaignSave(depleted)).toEqual(depleted);
});

test('saved active encounters cannot bypass earlier unresolved due arrivals', function () {
	const initial = makeSave();
	const first = commitExpedition(initial.campaign, { id: 'a', factionId: 'blue', sourceSystemId: 'home', destinationSystemId: 'away',
		contributions: [{ planetId: 'home:One', points: 20 }] });
	const second = commitExpedition(first, { id: 'z', factionId: 'blue', sourceSystemId: 'home', destinationSystemId: 'away',
		contributions: [{ planetId: 'home:One', points: 20 }] });
	const state = advanceCampaign(setCampaignPaused(second, false), 10);
	if (!state.encounter) throw new Error('Missing encounter');
	expect(isSupportedCampaignSave({ ...initial, campaign: state })).toBe(true);
	const corrupt = { ...state, encounter: { ...state.encounter, id: 'encounter:z', expeditionId: 'z' },
		expeditions: state.expeditions.map(function (order) {
			return { ...order, status: order.id === 'z' ? 'encounter' as const : 'traveling' as const };
		}) };
	expect(isSupportedCampaignSave({ ...initial, campaign: corrupt })).toBe(false);
});

test('historical capture events must alternate owners and agree with recorded final ownership', function () {
	const active = startEncounter(makeSave());
	const result = { encounterId: 'encounter:first', captureEvents: [], ownership: [
		{ planetId: 'away:One', factionId: 'red' as const }, { planetId: 'away:Two', factionId: 'red' as const },
	] };
	const state = applyCampaignEncounterResult(active.campaign, result);
	const recapture = { ...result, captureEvents: [
		{ planetId: 'away:One', factionId: 'blue' as const }, { planetId: 'away:One', factionId: 'red' as const },
	] };
	const recaptured = applyCampaignEncounterResult(active.campaign, recapture);
	expect(isSupportedCampaignSave({ ...active, campaign: recaptured })).toBe(true);
	for (const captureEvents of [
		[{ planetId: 'away:One', factionId: 'blue' }],
		[{ planetId: 'away:One', factionId: 'red' }, { planetId: 'away:Two', factionId: 'blue' }, { planetId: 'away:One', factionId: 'red' }, { planetId: 'away:Two', factionId: 'red' }],
	]) expect(isSupportedCampaignSave({ ...active, campaign: { ...state, resolvedEncounters: [{ ...result, captureEvents }] } })).toBe(false);
});

test('galaxy coordinates support negative positions without changing travel arithmetic', function () {
	const save = makeSave();
	const campaign = { ...save.campaign, systems: save.campaign.systems.map(function (system) {
		return { ...system, x: system.x - 150, y: -100 };
	}) };
	const active = startEncounter({ ...save, campaign });
	expect(parseCampaignSave(active)).toEqual(active);
});

test('allocation drafts round-trip with validated budgets, targets and active encounter identity', function () {
	const active = startEncounter(makeSave());
	const encounter = active.campaign.encounter;
	if (!encounter) throw new Error('Missing active encounter');
	const setup = createDefaultEncounterSetup(encounter);
	const save: CampaignSave = { ...active, encounterState: { phase: 'allocation', encounterId: encounter.id, setup } };
	expect(parseCampaignSave(save)).toEqual(save);
	for (const input of [
		{ ...save, encounterState: { ...save.encounterState, encounterId: 'other' } },
		{ ...save, campaign: makeSave().campaign },
		{ ...save, encounterState: { phase: 'allocation', encounterId: encounter.id, setup: { ...setup, defenders: [] } } },
		{ ...save, encounterState: { phase: 'allocation', encounterId: encounter.id, setup: { ...setup, beachheads: [{ planetId: 'away:One', troops: 999, ships: 0 }] } } },
		{ ...save, encounterState: { phase: 'allocation', encounterId: encounter.id, setup: { ...setup, beachheads: [{ planetId: 'home:One', troops: 1, ships: 0 }] } } },
	]) expect(isSupportedCampaignSave(input)).toBe(false);
});

test('rival beachhead allocation survives save and continue without rerolling', function () {
	const initial = makeSave();
	const state = commitExpedition(initial.campaign, { id: 'rival', factionId: 'red', sourceSystemId: 'away', destinationSystemId: 'home',
		contributions: [{ planetId: 'away:One', points: 40 }] });
	const active = { ...initial, campaign: advanceCampaign(setCampaignPaused(state, false), 10) };
	const encounter = active.campaign.encounter;
	if (!encounter) throw new Error('Missing rival encounter');
	const setup = createDefaultEncounterSetup(encounter);
	const save: CampaignSave = { ...active, encounterState: { phase: 'allocation', encounterId: encounter.id, setup } };
	const resumed = parseCampaignSave(save);
	expect(resumed.encounterState?.phase).toBe('allocation');
	if (resumed.encounterState?.phase !== 'allocation') throw new Error('Missing saved rival allocation');
	expect(resumed.encounterState.setup.beachheads).toEqual(setup.beachheads);
	expect(createDefaultEncounterSetup(encounter).beachheads).toEqual(resumed.encounterState.setup.beachheads);
});

test('older allocation and battle saves retain their already selected neutral beachheads', async function () {
	const initial = makeSave();
	const mixed = { ...initial.campaign, planets: initial.campaign.planets.map(function (planet) {
		return planet.id === 'home:Two' ? { ...planet, factionId: null } : planet;
	}) };
	const sent = commitExpedition(mixed, { id: 'legacy-rival', factionId: 'red', sourceSystemId: 'away', destinationSystemId: 'home',
		contributions: [{ planetId: 'away:One', points: 40 }] });
	const active = { ...initial, campaign: advanceCampaign(setCampaignPaused(sent, false), 10) };
	const encounter = active.campaign.encounter;
	if (!encounter) throw new Error('Missing rival encounter');
	const setup = { ...createDefaultEncounterSetup(encounter), beachheads: [{ planetId: 'home:Two', troops: 40, ships: 0 }] };
	const allocationSave: CampaignSave = { ...active, encounterState: { phase: 'allocation', encounterId: encounter.id, setup } };
	expect(parseCampaignSave(allocationSave)).toEqual(allocationSave);
	const committed = campaignBattleLaunchState(allocationSave, setup, { allowLegacyBeachheads: true });
	expect(committed.encounter?.defenseCommitments?.map(function (item) { return item.planetId; })).toEqual(['home:One']);
	expect(committed.planets.find(function (planet) { return planet.id === 'home:One'; })?.depletion).toBeGreaterThan(0);
	expect(committed.planets.find(function (planet) { return planet.id === 'home:Two'; })?.depletion)
		.toBe(active.campaign.planets.find(function (planet) { return planet.id === 'home:Two'; })?.depletion);

	const battle = await createCampaignBattle(active.campaign, setup, undefined, undefined, { allowLegacyBeachheads: true });
	let resumed: Awaited<ReturnType<typeof createCampaignBattle>> | undefined;
	try {
		const game = captureConquestSave(battle.world, battle.map, 'skirmish', 1, 'profile').game;
		const battleSave: CampaignSave = { ...active, encounterState: { phase: 'battle', encounterId: encounter.id, setup, game, captureEvents: [] } };
		const restored = parseCampaignSave(battleSave);
		expect(restored).toEqual(battleSave);
		expect(campaignBattleLaunchState(restored, setup, { allowLegacyBeachheads: true })).toBe(restored.campaign);
		const launchedSave: CampaignSave = { ...battleSave, campaign: committed };
		expect(parseCampaignSave(launchedSave)).toEqual(launchedSave);
		expect(campaignBattleLaunchState(launchedSave, setup, { allowLegacyBeachheads: true })).toBe(committed);
		if (restored.encounterState?.phase !== 'battle') throw new Error('Missing saved legacy battle');
		resumed = await createCampaignBattle(restored.campaign, restored.encounterState.setup, restored.encounterState.game,
			restored.encounterState.captureEvents, { allowLegacyBeachheads: true });
		expect(units(resumed.world).map(function (entity) { return entity.components.unit; }))
			.toEqual(units(battle.world).map(function (entity) { return entity.components.unit; }));
	} finally {
		await battle.world.dispose();
		await resumed?.world.dispose();
	}
});

test('tactical snapshots resume existing forces and point commitments without reseeding', async function () {
	const active = startEncounter(makeSave());
	const encounter = active.campaign.encounter;
	if (!encounter) throw new Error('Missing active encounter');
	const setup = createDefaultEncounterSetup(encounter);
	const battle = await createCampaignBattle(active.campaign, setup);
	try {
		const first = units(battle.world)[0];
		if (!first) throw new Error('Missing deployed forces');
		first.components.unit.hp = 0.5;
		const game = captureConquestSave(battle.world, battle.map, 'skirmish', 1, 'profile').game;
		const save: CampaignSave = { ...active, encounterState: { phase: 'battle', encounterId: encounter.id, setup, game,
			captureEvents: battle.runtime.getCaptureEvents() } };
		const restored = parseCampaignSave(save);
		expect(restored).toEqual(save);
		expect(campaignBattleLaunchState(restored, setup)).toBe(restored.campaign);
		expect(restored.campaign.encounter?.defenseCommitments).toBeUndefined();
		if (restored.encounterState?.phase !== 'battle') throw new Error('Missing battle snapshot');
		const resumed = await createCampaignBattle(restored.campaign, restored.encounterState.setup, restored.encounterState.game,
			restored.encounterState.captureEvents);
		try {
			expect(units(resumed.world).map(function (item) { return item.components.unit; })).toEqual(game.units.map(function (item) { return item.unit; }));
			expect(restored.campaign.planets.find(function (planet) { return planet.id === 'home:One'; })?.depletion).toBeCloseTo(29.9);
		} finally { await resumed.world.dispose(); }
		for (const encounterState of [
			{ ...save.encounterState, phase: 'battle', encounterId: encounter.id, setup, game: { ...game, scenario: 'invasion' }, captureEvents: [] },
			{ phase: 'battle', encounterId: encounter.id, setup, game: { ...game, match: { ...game.match, winner: 'blue' } }, captureEvents: [] },
			{ phase: 'battle', encounterId: encounter.id, setup, game, captureEvents: [{ planetId: 'away:One', factionId: 'blue' }] },
			{ phase: 'battle', encounterId: encounter.id, setup, game: { ...game, map: { ...game.map, width: 101 } }, captureEvents: [] },
		]) expect(isSupportedCampaignSave({ ...save, encounterState })).toBe(false);
	} finally { await battle.world.dispose(); }
});

test('capture history must replay into tactical ownership including transient recaptures', async function () {
	const active = startEncounter(makeSave());
	const encounter = active.campaign.encounter;
	if (!encounter) throw new Error('Missing active encounter');
	const setup = createDefaultEncounterSetup(encounter);
	const battle = await createCampaignBattle(active.campaign, setup);
	try {
		const snapshot = captureConquestSave(battle.world, battle.map, 'skirmish', 1, 'profile').game;
		const captureEvents = [{ planetId: 'away:One', factionId: 'blue' as const }, { planetId: 'away:One', factionId: 'red' as const }];
		const game = { ...snapshot, match: { ...snapshot.match, captures: 2 } };
		const save: CampaignSave = { ...active, encounterState: { phase: 'battle', encounterId: encounter.id, setup, game, captureEvents } };
		expect(isSupportedCampaignSave(save)).toBe(true);
		expect(isSupportedCampaignSave({ ...save, encounterState: { ...save.encounterState, captureEvents: [] } })).toBe(false);
		expect(isSupportedCampaignSave({ ...save, encounterState: { ...save.encounterState, captureEvents: [captureEvents[0], captureEvents[0]] } })).toBe(false);
	} finally { await battle.world.dispose(); }
});

test('campaign tactical restoration rejects sparse collections without changing skirmish parsing', async function () {
	const active = startEncounter(makeSave());
	const encounter = active.campaign.encounter;
	if (!encounter) throw new Error('Missing encounter');
	const setup = createDefaultEncounterSetup(encounter);
	const battle = await createCampaignBattle(active.campaign, setup);
	try {
		const game = captureConquestSave(battle.world, battle.map, 'skirmish', 1, 'profile').game;
		const wrapper = { phase: 'battle', encounterId: encounter.id, setup, game, captureEvents: [] };
		const games = [
			{ ...game, units: new Array(1) },
			{ ...game, planets: new Array(game.planets.length) },
			{ ...game, map: { ...game.map, planets: new Array(game.map.planets.length) } },
			{ ...game, match: { ...game.match, notices: new Array(1) } },
			{ ...game, orderBook: { ...game.orderBook, active: new Array(1) } },
			{ ...game, orderBook: { ...game.orderBook, active: [{ id: 1, owner: 'blue', target: game.planets[0]?.id,
				state: 'pending', departures: new Array(1) }] } },
		];
		for (const sparse of games) {
			expect(isSupportedCampaignSave({ ...active, encounterState: { ...wrapper, game: sparse } })).toBe(false);
			expect(function () { parseCampaignSave({ ...active, encounterState: { ...wrapper, game: sparse } }); }).toThrow(InvalidSaveError);
		}
	} finally { await battle.world.dispose(); }
});

test('a genuine battle containing a neutral planet round-trips and restores', async function () {
	const original = makeSave();
	const initial = { ...original, campaign: { ...original.campaign, planets: original.campaign.planets.map(function (planet) {
		return planet.id === 'away:Two' ? { ...planet, factionId: null } : planet;
	}) } };
	const active = startEncounter(initial);
	const encounter = active.campaign.encounter;
	if (!encounter) throw new Error('Missing encounter');
	const setup = createDefaultEncounterSetup(encounter);
	const battle = await createCampaignBattle(active.campaign, setup);
	try {
		const game = captureConquestSave(battle.world, battle.map, 'skirmish', 1, 'profile').game;
		expect(game.planets.some(function (item) { return item.planet.owner === 'neutral'; })).toBe(true);
		const save: CampaignSave = { ...active, encounterState: { phase: 'battle', encounterId: encounter.id, setup, game, captureEvents: [] } };
		const loaded = parseCampaignSave(save);
		expect(loaded).toEqual(save);
		if (loaded.encounterState?.phase !== 'battle') throw new Error('Missing saved battle');
		const restored = await createCampaignBattle(loaded.campaign, loaded.encounterState.setup, loaded.encounterState.game, loaded.encounterState.captureEvents);
		try {
			expect(captureConquestSave(restored.world, restored.map, 'skirmish', 1, 'profile').game).toEqual({ ...game, match: { ...game.match, paused: true } });
		} finally { await restored.world.dispose(); }
	} finally { await battle.world.dispose(); }
});

test('neutral claim fractions round-trip configured values and reject invalid values', function () {
	const save = makeSave();
	for (const neutralClaimFraction of [0, 0.1, 0.25, 1]) {
		const configured = { ...save, campaign: { ...save.campaign, rules: { ...save.campaign.rules, neutralClaimFraction } } };
		expect(parseCampaignSave(configured)).toEqual(configured);
	}
	for (const neutralClaimFraction of [-1, 1.01, NaN, Infinity, null, '0.1'])
		expect(isSupportedCampaignSave({ ...save, campaign: { ...save.campaign, rules: { ...save.campaign.rules, neutralClaimFraction } } })).toBe(false);
});

test('cancelled and recalled expeditions round-trip without duplicate refunds or revival', function () {
	const save = makeSave();
	const state = { ...save.campaign, rules: { ...save.campaign.rules, travelSpeed: 20 } };
	const order = { id: 'cancel', factionId: 'blue' as const, sourceSystemId: 'home', destinationSystemId: 'away',
		contributions: [{ planetId: 'home:One', points: 40 }] };
	const cancelled = cancelExpedition(commitExpedition(state, order), order.id, 'blue');
	const restored = parseCampaignSave({ ...save, campaign: cancelled }).campaign;
	expect(restored).toEqual(cancelled);
	expect(cancelExpedition(restored, order.id, 'blue')).toBe(restored);
	expect(commitExpedition(restored, order)).toBe(restored);
	const traveling = commitExpedition(restored, { ...order, id: 'recall' });
	const next = advanceCampaign(setCampaignPaused(traveling, false), 2);
	const returning = cancelExpedition(next, 'recall', 'blue');
	const recalledSave = parseCampaignSave({ ...save, campaign: returning });
	expect(recalledSave.campaign).toEqual(returning);
	const completed = advanceCampaign(returning, 2);
	expect(parseCampaignSave({ ...save, campaign: completed }).campaign).toEqual(completed);
	for (const invalid of [
		{ ...returning, expeditions: returning.expeditions.map(function (item) { return item.id === 'recall' ? { ...item, recalledTime: undefined } : item; }) },
		{ ...returning, expeditions: returning.expeditions.map(function (item) { return item.id === 'recall' ? { ...item, recalledTime: 0 } : item; }) },
		{ ...returning, expeditions: returning.expeditions.map(function (item) { return item.id === 'recall' ? { ...item, recalledTime: 3 } : item; }) },
	]) expect(isSupportedCampaignSave({ ...save, campaign: invalid })).toBe(false);
});

test('old turn-based saves require a new campaign without mutating the saved data', function () {
	const legacy = { ...makeSave(), schemaVersion: 1 };
	const before = structuredClone(legacy);
	expect(function () { parseCampaignSave(legacy); }).toThrow('Start a new campaign');
	expect(legacy).toEqual(before);
});

test('save validation rejects clock drift, overdue active arrivals and invalid pace', function () {
	const save = makeSave();
	const active = startEncounter(save);
	const state = active.campaign;
	for (const campaign of [
		{ ...state, pace: 3 },
		{ ...state, time: -1 },
		{ ...state, time: Infinity },
		{ ...state, nextRivalTime: state.time - 0.1 },
		{ ...state, paused: false },
		{ ...state, time: state.time + 1, nextRivalTime: state.time + 1,
			planets: state.planets.map(function (planet) { return { ...planet, lastAppliedTime: state.time + 1 }; }) },
	]) expect(isSupportedCampaignSave({ ...active, campaign })).toBe(false);
	for (const pace of [0.5, 1, 2]) expect(isSupportedCampaignSave({ ...save, campaign: { ...save.campaign, pace } })).toBe(true);
});


test('saved timing rules enforce the supported minimum event interval', function () {
	const save = makeSave();
	for (const field of ['rivalInterval', 'minimumTravelTime'] as const) {
		for (const interval of [0, Number.MIN_VALUE, MINIMUM_CAMPAIGN_EVENT_SECONDS / 2])
			expect(isSupportedCampaignSave({ ...save, campaign: { ...save.campaign,
				rules: { ...save.campaign.rules, [field]: interval } } })).toBe(false);
		expect(isSupportedCampaignSave({ ...save, campaign: { ...save.campaign,
			rules: { ...save.campaign.rules, [field]: MINIMUM_CAMPAIGN_EVENT_SECONDS } } })).toBe(true);
	}
});


test('defenses spend only allocated owned-planet points once across save, resume and resolution', async function () {
	const active = startEncounter(makeSave());
	const encounter = active.campaign.encounter;
	if (!encounter) throw new Error('Expected encounter');
	const setup = { ...createDefaultEncounterSetup(encounter), defenders: [
		{ planetId: 'away:One', forces: { troops: 3, ships: 2, guns: 1 } },
		{ planetId: 'away:Two', forces: { troops: 0, ships: 0, guns: 0 } },
	] };
	const draft = parseCampaignSave({ ...active, encounterState: { phase: 'allocation', encounterId: encounter.id, setup } });
	expect(draft.campaign).toEqual(active.campaign);
	const committed = campaignBattleLaunchState(draft, setup);
	expect(committed.planets.find(function (planet) { return planet.id === 'away:One'; })?.depletion).toBe(20);
	expect(committed.planets.find(function (planet) { return planet.id === 'away:Two'; })?.depletion).toBe(0);
	expect(committed.planets.filter(function (planet) { return planet.systemId === 'home'; }))
		.toEqual(active.campaign.planets.filter(function (planet) { return planet.systemId === 'home'; }));
	expect(active.campaign.planets.find(function (planet) { return planet.id === 'away:One'; })?.depletion).toBe(0);
	const battle = await createCampaignBattle(committed, setup);
	try {
		const save: CampaignSave = { ...active, campaign: committed, encounterState: { phase: 'battle', encounterId: encounter.id, setup,
			game: captureConquestSave(battle.world, battle.map, 'skirmish', 1, 'profile').game, captureEvents: [] } };
		const restored = parseCampaignSave(save);
		expect(campaignBattleLaunchState(restored, setup)).toBe(restored.campaign);
		const altered = { ...setup, defenders: setup.defenders.map(function (item) {
			return { ...item, forces: { ...item.forces, troops: item.forces.troops + 1 } };
		}) };
		expect(function () { commitEncounterDefenses(restored.campaign, altered); }).toThrow('cannot be changed');
		expect(isSupportedCampaignSave({ ...save, encounterState: { ...save.encounterState, setup: altered } })).toBe(false);
		expect(isSupportedCampaignSave({ ...save, encounterState: { phase: 'allocation', encounterId: encounter.id, setup } })).toBe(false);
		expect(isSupportedCampaignSave({ ...save, encounterState: undefined })).toBe(false);
		expect(isSupportedCampaignSave({ ...save, campaign: { ...committed, planets: active.campaign.planets } })).toBe(false);
		const result = { encounterId: encounter.id, captureEvents: [], ownership: encounter.planets.map(function (planet) {
			return { planetId: planet.planetId, factionId: planet.factionId };
		}) };
		const resolved = applyCampaignEncounterResult(restored.campaign, result);
		expect(resolved.planets.find(function (planet) { return planet.id === 'away:One'; })?.depletion).toBe(20);
		expect(applyCampaignEncounterResult(resolved, result)).toBe(resolved);
		expect(parseCampaignSave({ ...active, campaign: resolved }).campaign).toEqual(resolved);
	} finally { await battle.world.dispose(); }
});


test('fractional recovered balances round-trip after defense spending without accepting a whole-point mismatch', async function () {
	const initial = makeSave();
	const fractional = { ...initial, campaign: { ...initial.campaign, planets: initial.campaign.planets.map(function (planet) {
		return { ...planet, depletion: 23.46789123456789 };
	}) } };
	const active = startEncounter(fractional);
	const encounter = active.campaign.encounter;
	if (!encounter) throw new Error('Expected encounter');
	const setup = createDefaultEncounterSetup(encounter);
	const campaign = commitEncounterDefenses(active.campaign, setup);
	const battle = await createCampaignBattle(campaign, setup);
	try {
		const save: CampaignSave = { ...active, campaign, encounterState: { phase: 'battle', encounterId: encounter.id, setup,
			game: captureConquestSave(battle.world, battle.map, 'skirmish', 1, 'profile').game, captureEvents: [] } };
		expect(parseCampaignSave(save)).toEqual(save);
		expect(isSupportedCampaignSave({ ...save, campaign: { ...campaign, planets: campaign.planets.map(function (planet) {
			return planet.id === 'away:One' ? { ...planet, depletion: planet.depletion + 1 } : planet;
		}) } })).toBe(false);
	} finally { await battle.world.dispose(); }
});


test('large defense balances reject whole-point mismatches without reconstruction tolerance', function () {
	const active = startEncounter(makeSave());
	const encounter = active.campaign.encounter;
	if (!encounter) throw new Error('Expected encounter');
	const maximum = Number.MAX_SAFE_INTEGER - 2000;
	const campaign = { ...active.campaign, planets: active.campaign.planets.map(function (planet) {
		return planet.systemId === 'away' ? { ...planet, baselinePoints: maximum, developmentBonusPoints: 0, depletion: maximum - 10 } : planet;
	}), encounter: { ...encounter, planets: encounter.planets.map(function (planet) { return { ...planet, points: 10 }; }) } };
	const setup = createDefaultEncounterSetup(campaign.encounter);
	const committed = commitEncounterDefenses(campaign, setup);
	expect(campaignStateSchema.safeParse(committed).success).toBe(true);
	if (!committed.encounter) throw new Error('Expected committed encounter');
	for (const difference of [1, 4]) {
		expect(campaignStateSchema.safeParse({ ...committed, encounter: { ...committed.encounter,
			planets: committed.encounter.planets.map(function (planet) { return { ...planet, points: planet.points + difference }; }),
		} }).success).toBe(false);
		expect(campaignStateSchema.safeParse({ ...committed, planets: committed.planets.map(function (planet) {
			return planet.systemId === 'away' ? { ...planet, depletion: planet.depletion - difference } : planet;
		}) }).success).toBe(false);
	}
});
