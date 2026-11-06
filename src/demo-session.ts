import { isHostile } from './config';
import { matchEnded, planets, units, type Game } from './game';
import { isFirstCommandMap } from './demo-content';
import { GAME_MODES } from './objectives';
import type { StarMap } from './maps';
import { formatElapsedTime } from './time-format';

const find = function <T extends HTMLElement>(id: string, type: { new (...args: never[]): T }): T {
	const node = document.getElementById(id);
	if (!(node instanceof type)) throw new Error(`Missing demo control: ${id}`);
	return node;
};

export interface DemoSession {
	update(): void;
	reset(): void;
	start(): void;
	dispose(): void;
}

export const createDemoSession = function (options: {
	world: () => Game;
	map: () => StarMap;
	selected: () => readonly number[];
	playing: () => boolean;
	focusWorld: (id: number) => void;
	refresh: () => void;
	rematch: () => Promise<void>;
	newOperation: () => void;
}): DemoSession {
	const listeners = new AbortController();
	const briefing = find('mission-briefing', HTMLDialogElement);
	const results = find('battle-results', HTMLDialogElement);
	const coach = find('command-coach', HTMLElement);
	const report = find('battle-report', HTMLButtonElement);
	const action = find('coach-action', HTMLButtonElement);
	let dismissed = false;
	let resultShown = false;
	let briefingShown = false;
	let builtShips = false;
	let selectedHome = false;
	let pending = false;
	let coachTarget: number | undefined;
	let lastCoach = '';
	const listen = function (id: string, handler: () => void): void {
		find(id, HTMLElement).addEventListener('click', handler, { signal: listeners.signal });
	};
	const showResults = function (): void {
		const world = options.world();
		const match = world.getResource('match');
		if (!matchEnded(match)) return;
		const won = match.winner === 'blue' && !match.defeated;
		find('result-kicker', HTMLElement).textContent = `${GAME_MODES[world.getResource('objectives').mode].label.toUpperCase()} / AFTER ACTION`;
		find('result-title', HTMLElement).textContent = match.draw ? 'A contested horizon.' : won ? 'The system is yours.' : 'A foothold lost.';
		const race = world.getResource('objectives').mode !== 'conquest';
		find('result-description', HTMLElement).textContent = match.draw ? 'The operation ended in a draw. The next move belongs to you.' : won
			? race ? 'Your fleet secured the carrier operation. The route is yours.' : 'No rival holdings remain. Your fleet controls the system.'
			: 'The rival secured the operation. Rebuild your approach: expand early, escort transports, and keep a reserve.';
		results.dataset.outcome = match.draw ? 'draw' : won ? 'victory' : 'defeat';
		const stats: readonly (readonly [string, string])[] = [
			['Operation time', formatElapsedTime(match.time)],
			['Your orders', String(match.orders)],
			['First capture', match.firstCapture === null ? '—' : formatElapsedTime(match.firstCapture)],
			['Your holdings', String(planets(world).filter(function (entry) { return entry.components.planet.owner === 'blue'; }).length)],
			['All factions · captures', String(match.captures)],
			['All factions · troops lost in transit', String(match.troopsLost)],
		];
		find('result-stats', HTMLDListElement).replaceChildren(...stats.map(function ([label, value]) {
			const row = document.createElement('div');
			const term = document.createElement('dt'); term.textContent = label;
			const detail = document.createElement('dd'); detail.textContent = value;
			row.append(term, detail); return row;
		}));
		if (!results.open) results.showModal();
		find('result-rematch', HTMLButtonElement).focus();
	};
	const update = function (): void {
		if (!options.playing()) return;
		const world = options.world();
		const match = world.getResource('match');
		const all = planets(world);
		const mode = world.getResource('objectives').mode;
		const guidance = find('show-coach', HTMLButtonElement);
		guidance.hidden = !isFirstCommandMap(options.map());
		guidance.setAttribute('aria-pressed', String(!dismissed));
		guidance.textContent = dismissed ? 'Guidance: Off' : 'Guidance: On';
		const rivalHoldings = all.filter(function (entry) { return isHostile(entry.components.planet.owner, 'blue'); }).length;
		find('objective-label', HTMLElement).textContent = isFirstCommandMap(options.map()) ? 'FIRST COMMAND' : GAME_MODES[mode].label.toUpperCase();
		find('objective-text', HTMLElement).textContent = matchEnded(match) ? 'Operation complete' : mode === 'conquest'
			? `${rivalHoldings} rival ${rivalHoldings === 1 ? 'holding' : 'holdings'} remaining`
			: mode === 'center-race' ? 'Reach the central beacon with your carrier' : 'Get your carrier to its destination';
		report.hidden = !matchEnded(match);
		if (matchEnded(match)) {
			coach.hidden = true;
			if (!resultShown && !document.querySelector('dialog[open]')) { resultShown = true; showResults(); }
			return;
		}
		const mine = all.filter(function (entry) { return entry.components.planet.owner === 'blue'; });
		selectedHome ||= options.selected().some(function (id) { return mine.some(function (entry) { return entry.id === id; }); });
		builtShips ||= mine.some(function (entry) { return entry.components.planet.production === 'ships'; });
		coach.hidden = dismissed || !isFirstCommandMap(options.map()) || briefing.open;
		if (coach.hidden) return;
		const phase = !selectedHome && match.orders === 0 ? 0 : match.orders === 0 ? 1 : match.firstCapture === null ? 2 : !builtShips ? 3 : 4;
		const home = mine[0];
		const neutral = all.filter(function (entry) { return entry.components.planet.owner === 'neutral'; }).sort(function (a, b) {
			if (!home) return 0;
			return Math.hypot(a.components.planet.x - home.components.planet.x, a.components.planet.y - home.components.planet.y) - Math.hypot(b.components.planet.x - home.components.planet.x, b.components.planet.y - home.components.planet.y);
		})[0];
		const queued = world.getResource('orderBook').active.some(function (order) { return order.owner === 'blue' && order.state === 'pending' && order.departures.length > 0; });
		const awaitingResume = match.paused && (queued || units(world).some(function (entry) { return entry.components.unit.owner === 'blue' && entry.components.unit.phase === 'travel'; }));
		const traveling = units(world).some(function (entry) { return entry.components.unit.owner === 'blue' && entry.components.unit.phase === 'travel'; });
		const steps = [
			['Your first foothold', 'Select your blue world. Its troops take ground; its warships protect the journey.', 'Locate home world'],
			['Send an expedition', `Choose Send, then a destination. Half your starting force can take ${neutral?.components.planet.name ?? 'a nearby neutral world'}. Right-click or hold is a shortcut.`, 'Locate home world'],
			[awaitingResume ? 'Orders ready. Resume to launch.' : traveling ? 'Keep the convoy covered' : 'Plan the next expedition', awaitingResume ? 'Your orders reserve forces while paused. Resume at the top to let the fleet travel.' : traveling ? 'Transports carry troops and fly slower than warships. They land once hostile orbital defenses are cleared.' : 'Your first capture is still ahead. Send troops with escorts to a nearby neutral world.', 'Locate home world'],
			['Give each world a role', 'Select one of your worlds, open Build, and produce ships. Let another world keep recruiting troops.', 'Locate a world'],
			['You have the command', 'Expand your economy, keep escorts with your troops, and take every rival holding. Pause to coordinate several worlds at once.', 'Dismiss guidance'],
		];
		const step = steps[phase];
		if (!step) return;
		coachTarget = phase === 4 ? undefined : home?.id;
		const key = `${phase}:${match.paused}:${queued}:${traveling}:${neutral?.id}`;
		if (key !== lastCoach) {
			lastCoach = key;
			find('coach-step', HTMLElement).textContent = `COMMAND GUIDANCE / ${phase + 1} OF 5`;
			find('coach-title', HTMLElement).textContent = step[0] ?? '';
			find('coach-detail', HTMLElement).textContent = step[1] ?? '';
			action.textContent = `${step[2]} →`;
		}
	};
	listen('dismiss-coach', function () { dismissed = true; coach.hidden = true; options.refresh(); });
	listen('show-coach', function () { dismissed = !dismissed; update(); });
	listen('coach-action', function () {
		if (coachTarget !== undefined) options.focusWorld(coachTarget);
		else { dismissed = true; coach.hidden = true; }
	});
	listen('battle-report', showResults);
	listen('result-close', function () { results.close(); find('board', HTMLElement).focus(); });
	listen('result-new', function () { if (!pending) { results.close(); options.newOperation(); } });
	listen('result-rematch', function () {
		if (pending) return;
		pending = true;
		find('result-rematch', HTMLButtonElement).disabled = true;
		void options.rematch().then(function () { results.close(); }).catch(function (error: unknown) {
			find('result-status', HTMLElement).textContent = error instanceof Error ? error.message : 'Could not restart. Your previous game was kept.';
		}).finally(function () { pending = false; find('result-rematch', HTMLButtonElement).disabled = false; });
	});
	briefing.addEventListener('close', function () {
		if (briefing.returnValue === 'launch' && options.playing() && !document.hidden && document.hasFocus()) options.world().getResource('match').paused = false;
		options.refresh(); find('board', HTMLElement).focus();
	}, { signal: listeners.signal });
	results.addEventListener('close', function () { if (options.playing()) find('board', HTMLElement).focus(); }, { signal: listeners.signal });
	return {
		update,
		reset: function (): void {
			dismissed = false; resultShown = false; briefingShown = false; builtShips = false; selectedHome = false; lastCoach = '';
			briefing.close(); results.close(); coach.hidden = true;
		},
		start: function (): void {
			if (isFirstCommandMap(options.map()) && options.world().getResource('match').time < 0.1 && !briefingShown) {
				briefingShown = true; options.world().getResource('match').paused = true;
				briefing.returnValue = ''; briefing.showModal();
			}
			update();
		},
		dispose: function (): void { listeners.abort(); briefing.close(); results.close(); },
	};
};
