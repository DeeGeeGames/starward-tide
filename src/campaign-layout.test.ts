import { expect, test } from 'bun:test';
import { campaignLayout } from './campaign-layout';
import { createCampaign, createGeneratedCampaign } from './campaign-scenario';
import { generateMap } from './maps';

test('legacy campaign display keeps adjacent markers and their labels apart without changing travel coordinates', function () {
	const campaign = createCampaign();
	const before = structuredClone(campaign);
	const layout = campaignLayout(campaign.systems);
	for (const [index, system] of campaign.systems.entries()) {
		for (const other of campaign.systems.slice(index + 1)) {
			expect(Math.hypot(other.x - system.x, other.y - system.y) * layout.scale).toBeGreaterThanOrEqual(280);
		}
	}
	expect(campaign).toEqual(before);
});

test('generated galaxy display preserves relative distances and fits every system within padded bounds', function () {
	for (const size of ['small', 'medium', 'large'] as const) {
		const campaign = createGeneratedCampaign(generateMap(size, 8041));
		const layout = campaignLayout(campaign.systems);
		expect(layout.scale).toBe(1);
		for (const system of campaign.systems) {
			const x = 220 + (system.x - layout.minX) * layout.scale;
			const y = 120 + (system.y - layout.minY) * layout.scale;
			expect(x).toBeGreaterThanOrEqual(220);
			expect(y).toBeGreaterThanOrEqual(120);
			expect(x).toBeLessThanOrEqual(layout.width - 220);
			expect(y).toBeLessThanOrEqual(layout.height - 240);
		}
	}
});
