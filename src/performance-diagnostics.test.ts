import { describe, expect, test } from 'bun:test';
import { createGame, units } from './game';
import { createCrowdedBaseline } from './performance-scenario';
import { summarizeTimings } from './performance-diagnostics';
import { captureConquestSave } from './game-save';
import { parseConquestSave } from './save-state';

describe('performance diagnostics baseline', function () {
	test('percentiles retain spikes and handle empty windows', function () {
		expect(summarizeTimings([]).max).toBe(0);
		const summary = summarizeTimings([...Array.from({ length: 99 }, function () { return 16; }), 120]);
		expect(summary).toEqual({ count: 100, p50: 16, p95: 16, p99: 16, max: 120, over50: 1 });
	});
	test('fixture is deterministic, save compatible, and stable across two autosave intervals', async function () {
		const snapshot = createCrowdedBaseline();
		expect(snapshot).toEqual(createCrowdedBaseline());
		const world = await createGame(snapshot.scenario, snapshot.map, snapshot);
		try {
			expect(world.diagnosticsEnabled).toBe(false);
			expect(world.isSystemGroupEnabled('diagnostics')).toBe(false);
			world.getResource('match').paused = false;
			for (let i = 0; i < 600; i++) world.update(0.05);
			const all = units(world);
			expect(all.filter(function (entity) { return entity.components.unit.kind === 'ship'; })).toHaveLength(1200);
			expect(all.filter(function (entity) { return entity.components.unit.kind === 'transport'; })).toHaveLength(300);
			expect(world.getResource('match').winner).toBeNull();
			const save = captureConquestSave(world, snapshot.map, snapshot.scenario, 1, 'baseline');
			expect(parseConquestSave(save, 'baseline').game.units).toHaveLength(1500);
			expect(world.systemTimings.size).toBe(0);
		} finally { await world.dispose(); }
	});
	test('timing collection preserves simulation results and stops when disabled', async function () {
		const snapshot = createCrowdedBaseline();
		const plain = await createGame(snapshot.scenario, snapshot.map, snapshot);
		const timed = await createGame(snapshot.scenario, snapshot.map, snapshot);
		try {
			timed.enableDiagnostics(true);
			timed.enableSystemGroup('diagnostics');
			for (const world of [plain, timed]) {
				world.getResource('match').paused = false;
				world.update(0.05);
			}
			expect(timed.systemTimings.size).toBeGreaterThan(0);
			expect(captureConquestSave(timed, snapshot.map, 'skirmish', 1, 'test', 0))
				.toEqual(captureConquestSave(plain, snapshot.map, 'skirmish', 1, 'test', 0));
			timed.enableDiagnostics(false);
			timed.disableSystemGroup('diagnostics');
			timed.update(0.05);
			expect(timed.diagnosticsEnabled).toBe(false);
			expect(timed.systemTimings.size).toBe(0);
		} finally { await plain.dispose(); await timed.dispose(); }
	});
});
