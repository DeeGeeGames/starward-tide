import type { CampaignSystem } from './campaign-state';

/** Preserve galaxy proportions while expanding compact legacy layouts for readable markers. */
export const campaignLayout = function (systems: readonly CampaignSystem[]): {
	minX: number; minY: number; scale: number; width: number; height: number;
} {
	const xs = systems.map(function (system) { return system.x; });
	const ys = systems.map(function (system) { return system.y; });
	const minX = systems.length ? Math.min(...xs) : 0;
	const minY = systems.length ? Math.min(...ys) : 0;
	const spanX = systems.length ? Math.max(...xs) - minX : 0;
	const spanY = systems.length ? Math.max(...ys) - minY : 0;
	const scale = Math.max(1, 560 / Math.max(1, spanX, spanY));
	return { minX, minY, scale, width: spanX * scale + 440, height: spanY * scale + 360 };
};
