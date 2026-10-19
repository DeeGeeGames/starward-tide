import { expect, test } from 'bun:test';
import { clearCampaignSelection, emptyCampaignSelection, focusCampaignSystem, reconcileCampaignSelection, selectCampaignSystem } from './campaign-selection';
import { createCampaign } from './campaign-scenario';

test('campaign entry defaults to the first owned system as the selected funding source', function () {
	const state = createCampaign();
	expect(reconcileCampaignSelection(emptyCampaignSelection(), state)).toEqual({
		selectedSystemId: 'sol', sourceSystemId: 'sol', initialized: true,
	});
});

test('selecting the current system again clears both selection and funding source', function () {
	const state = createCampaign();
	const selected = selectCampaignSystem(emptyCampaignSelection(), state, 'sol');
	expect(selectCampaignSystem(selected, state, 'sol')).toEqual({
		selectedSystemId: undefined, sourceSystemId: undefined, initialized: true,
	});
});

test('inspecting an unowned system clears the previous funding source and can be deselected', function () {
	const state = createCampaign();
	const selected = selectCampaignSystem(reconcileCampaignSelection(emptyCampaignSelection(), state), state, 'deneb');
	expect(selected).toEqual({ selectedSystemId: 'deneb', sourceSystemId: undefined, initialized: true });
	expect(selectCampaignSystem(selected, state, 'deneb')).toEqual({
		selectedSystemId: undefined, sourceSystemId: undefined, initialized: true,
	});
});

test('programmatic focus keeps an already selected system open', function () {
	const state = createCampaign();
	const selected = selectCampaignSystem(emptyCampaignSelection(), state, 'sol');
	expect(focusCampaignSystem(selected, state, 'sol')).toEqual(selected);
});

test('render updates do not restore a deliberately cleared source, including after ownership changes', function () {
	const state = createCampaign();
	const cleared = clearCampaignSelection();
	const changed = { ...state, time: state.time + 1, planets: state.planets.map(function (planet) {
		return planet.systemId === 'deneb' ? { ...planet, factionId: 'blue' as const } : planet;
	}) };
	expect(reconcileCampaignSelection(cleared, changed)).toEqual(cleared);
});

test('losing ownership clears the source while keeping the selected system available for inspection', function () {
	const state = createCampaign();
	const selected = selectCampaignSystem(emptyCampaignSelection(), state, 'sol');
	const captured = { ...state, planets: state.planets.map(function (planet) {
		return planet.systemId === 'sol' ? { ...planet, factionId: 'red' as const } : planet;
	}) };
	expect(reconcileCampaignSelection(selected, captured)).toEqual({
		selectedSystemId: 'sol', sourceSystemId: undefined, initialized: true,
	});
});

test('a selected inspected system becomes a funding source when it becomes owned', function () {
	const state = createCampaign();
	const inspected = selectCampaignSystem(reconcileCampaignSelection(emptyCampaignSelection(), state), state, 'deneb');
	const captured = { ...state, planets: state.planets.map(function (planet) {
		return planet.systemId === 'deneb' ? { ...planet, factionId: 'blue' as const } : planet;
	}) };
	expect(reconcileCampaignSelection(inspected, captured)).toEqual({
		selectedSystemId: 'deneb', sourceSystemId: 'deneb', initialized: true,
	});
});

test('a new campaign entry initializes selection from its current ownership', function () {
	const state = createCampaign();
	const captured = { ...state, planets: state.planets.map(function (planet) {
		return planet.systemId === 'sol' ? { ...planet, factionId: 'red' as const }
			: planet.systemId === 'deneb' ? { ...planet, factionId: 'blue' as const } : planet;
	}) };
	expect(reconcileCampaignSelection(emptyCampaignSelection(), captured)).toEqual({
		selectedSystemId: 'deneb', sourceSystemId: 'deneb', initialized: true,
	});
});
