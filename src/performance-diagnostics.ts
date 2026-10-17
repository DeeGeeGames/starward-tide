import type { Game } from './game';

export const summarizeTimings = function (values: readonly number[]): {
	count: number; p50: number; p95: number; p99: number; max: number; over50: number;
} {
	const sorted = [...values].sort(function (a, b) { return a - b; });
	const percentile = function (fraction: number): number {
		return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
	};
	return { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95),
		p99: percentile(0.99), max: sorted.at(-1) ?? 0,
		over50: values.filter(function (value) { return value > 50; }).length };
};

export interface DiagnosticsReport {
	enabled: boolean;
	elapsedMs: number;
	sampleLimit: number;
	context: unknown;
	entityCount: number;
	metrics: Record<string, ReturnType<typeof summarizeTimings>>;
	systems: Record<string, number>;
	phases: Record<string, number>;
	ecsUpdateCadenceFps: number;
	saveEvents: { phase: string; elapsedMs: number; durationMs: number }[];
}
export interface PerformanceDiagnostics {
	setEnabled: (enabled: boolean) => void;
	measure: <T>(name: string, action: () => T) => T;
	frame: (now: number) => void;
	report: () => DiagnosticsReport;
	reset: () => void;
	dispose: () => void;
}

// Bounded raw samples preserve spikes without unbounded late-game memory growth.
const sampleLimit = 7200;
export const createPerformanceDiagnostics = function (
	world: Game,
	context: () => unknown,
): PerformanceDiagnostics {
	let enabled = false;
	let previousRaf: number | undefined;
	let panel: HTMLPreElement | undefined;
	let timer: number | undefined;
	let startedAt = performance.now();
	const samples = new Map<string, number[]>();
	const saveEvents: DiagnosticsReport['saveEvents'] = [];
	const record = function (name: string, duration: number): void {
		if (!enabled) return;
		let values = samples.get(name);
		if (!values) { values = []; samples.set(name, values); }
		if (values.length === sampleLimit) values.shift();
		values.push(duration);
		if (name.startsWith('save.')) {
			if (saveEvents.length === 100) saveEvents.shift();
			saveEvents.push({ phase: name, elapsedMs: performance.now() - startedAt, durationMs: duration });
		}
	};
	const reset = function (): void {
		samples.clear();
		saveEvents.length = 0;
		previousRaf = undefined;
		startedAt = performance.now();
	};
	const report = function (): DiagnosticsReport {
		return {
			saveEvents: [...saveEvents],
			enabled, elapsedMs: performance.now() - startedAt, sampleLimit,
			context: context(), entityCount: world.entityCount,
			metrics: Object.fromEntries([...samples].map(function ([name, values]) {
				return [name, summarizeTimings(values)];
			})),
			// Snapshot the world getters after update; the plugin's render collector
			// runs before render timing has finished in ECSpresso 0.24.1.
			systems: Object.fromEntries(world.systemTimings),
			phases: { ...world.phaseTimings },
			ecsUpdateCadenceFps: world.getResource('diagnostics').fps,
		};
	};
	const setEnabled = function (next: boolean): void {
		if (next === enabled) return;
		enabled = next;
		world.enableDiagnostics(next);
		if (next) world.enableSystemGroup('diagnostics');
		else world.disableSystemGroup('diagnostics');
		if (timer !== undefined) window.clearInterval(timer);
		timer = undefined;
		panel?.remove();
		panel = undefined;
		reset();
		if (!next) return;
		panel = document.createElement('pre');
		panel.id = 'performance-diagnostics';
		panel.style.cssText = 'position:fixed;top:8px;left:8px;z-index:999999;max-height:85vh;overflow:hidden;background:#07121fee;color:#b9e9ff;padding:12px;font:12px/1.4 monospace;pointer-events:none;max-width:95vw';
		document.body.append(panel);
		const render = function (): void {
			if (!panel) return;
			const data = report();
			const cadence = data.metrics['raf'];
			panel.textContent = [
				'DEVELOPER DIAGNOSTICS · ms · rolling 7200 samples',
				`Entities ${data.entityCount} · RAF median FPS ${cadence?.p50 ? (1000 / cadence.p50).toFixed(1) : '—'}`,
				'                      count    p50    p95    p99    max  >50ms',
				...Object.entries(data.metrics).map(function ([name, value]) {
					return `${name.padEnd(22)} ${String(value.count).padStart(5)} ${[value.p50, value.p95, value.p99, value.max].map(function (n) { return n.toFixed(2).padStart(6); }).join(' ')} ${value.over50}`;
				}),
				'Latest ECS phases (includes scheduling/queries; last invocation; may be stale without a fixed tick):',
				JSON.stringify(data.phases),
				'Latest ECS systems (process only; last invocation; may be stale without a fixed tick):',
				...Object.entries(data.systems).map(function ([name, value]) { return `${name}: ${value.toFixed(3)}`; }),
				`ECS update cadence FPS ${data.ecsUpdateCadenceFps.toFixed(1)} (stale while paused)`,
				'Console: conquestDiagnostics.report() / reset() / enable(false)',
			].join('\n');
		};
		render();
		timer = window.setInterval(render, 500);
	};
	const measure = function <T>(name: string, action: () => T): T {
		if (!enabled) return action();
		const start = performance.now();
		try { return action(); }
		finally {
			record(name, performance.now() - start);
			// ECSpresso exposes the latest invocation, not a sum across fixed ticks.
			if (name === 'simulation') {
				for (const [phase, duration] of Object.entries(world.phaseTimings)) record(`phase.${phase}`, duration);
				for (const [system, duration] of world.systemTimings) record(`system.${system}`, duration);
			}
		}
	};
	const frame = function (now: number): void {
		if (!enabled) return;
		if (previousRaf !== undefined) record('raf', now - previousRaf);
		previousRaf = now;
	};
	const dispose = function (): void { setEnabled(false); };
	world.addResource('diagnosticsLifetime', { factory: function () { return { dispose }; },
		onDispose: function (resource) { resource.dispose(); } });
	world.getResource('diagnosticsLifetime');
	return { setEnabled, measure, frame, report, reset, dispose };
};
