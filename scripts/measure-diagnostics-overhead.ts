import { createGame } from '../src/game';
import { createCrowdedBaseline } from '../src/performance-scenario';
import { summarizeTimings } from '../src/performance-diagnostics';

// CPU-only companion to the browser A/B. No Canvas, HUD, or app overlay here.
const measure = async function (enabled: boolean): Promise<number> {
	const snapshot = createCrowdedBaseline();
	const world = await createGame(snapshot.scenario, snapshot.map, snapshot);
	try {
		world.getResource('match').paused = false;
		world.enableDiagnostics(enabled);
		if (enabled) world.enableSystemGroup('diagnostics');
		for (let step = 0; step < 20; step++) world.update(0.05);
		const start = performance.now();
		for (let step = 0; step < 100; step++) world.update(0.05);
		return (performance.now() - start) / 100;
	} finally {
		await world.dispose();
	}
};
const enabled: number[] = [];
const disabled: number[] = [];
for (let round = 0; round < 10; round++) {
	// Alternate order to reduce consistent JIT/thermal/order bias.
	for (const timing of round % 2 === 0 ? [false, true] : [true, false]) {
		const value = await measure(timing);
		(timing ? enabled : disabled).push(value);
	}
}
const enabledSummary = summarizeTimings(enabled);
const disabledSummary = summarizeTimings(disabled);
console.log(JSON.stringify({
	runtime: `Bun ${Bun.version}`, fixture: 'crowded-v1',
	note: 'ms/update; 10 alternating pairs, 20 warm-up + 100 measured fixed steps per world; ECS plugin only, excludes application instrumentation and browser rendering',
	enabled, disabled, enabledSummary, disabledSummary,
	medianDeltaMs: enabledSummary.p50 - disabledSummary.p50,
	medianDeltaPercent: (enabledSummary.p50 / disabledSummary.p50 - 1) * 100,
}, null, '\t'));
