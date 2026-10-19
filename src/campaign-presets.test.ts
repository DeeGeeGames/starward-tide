import { expect, test } from 'bun:test';
import { allocationsForCampaignPreset, pointsForCampaignPreset } from './campaign-presets';

test('campaign presets allocate whole points from each owned planet independently', function () {
	const balances = [
		{ planetId: 'one', factionId: 'blue', availablePoints: 25.8 },
		{ planetId: 'two', factionId: 'blue', availablePoints: 14.9 },
		{ planetId: 'three', factionId: 'blue', availablePoints: 0.9 },
		{ planetId: 'rival', factionId: 'red', availablePoints: 100 },
	] as const;

	expect([...allocationsForCampaignPreset(balances, 50)]).toEqual([
		['one', 12], ['two', 7], ['three', 0],
	]);
	expect(pointsForCampaignPreset(25.8, 25)).toBe(6);
	expect(pointsForCampaignPreset(25.8, 100)).toBe(25);
});

test('campaign presets recalculate from recovered balances when the next order is prepared', function () {
	const beforeRecovery = [
		{ planetId: 'one', factionId: 'blue', availablePoints: 25.8 },
		{ planetId: 'two', factionId: 'blue', availablePoints: 14.9 },
	] as const;
	const afterRecovery = [
		{ planetId: 'one', factionId: 'blue', availablePoints: 27.8 },
		{ planetId: 'two', factionId: 'blue', availablePoints: 16.9 },
	] as const;

	expect([...allocationsForCampaignPreset(beforeRecovery, 50)]).toEqual([['one', 12], ['two', 7]]);
	expect([...allocationsForCampaignPreset(afterRecovery, 50)]).toEqual([['one', 13], ['two', 8]]);
});
