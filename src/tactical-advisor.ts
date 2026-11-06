import { CONFIG, isHostile, type Production, type Side } from './config';
import type { Planet, previewDispatch } from './game';

const productionLabels: Record<Production, string> = {
	troops: 'Troops',
	ships: 'Warships',
	guns: 'Defense platforms',
};

type ProductionWorld = Readonly<Pick<Planet, 'owner' | 'production' | 'progress' | 'rate'>>;

export interface ProductionEstimate {
	readonly label: string;
	readonly percent: number;
	/** Simulation seconds; pauses and the selected game pace affect wall time. */
	readonly secondsRemaining: number | null;
	readonly detail: string;
}

const duration = function (seconds: number): string {
	const rounded = Math.ceil(seconds);
	return rounded < 60 ? `${rounded}s` : `${Math.floor(rounded / 60)}m ${String(rounded % 60).padStart(2, '0')}s`;
};

export const productionEstimate = function (planet: ProductionWorld): ProductionEstimate {
	if (planet.owner === 'neutral') return { label: 'Inactive', percent: 0, secondsRemaining: null, detail: 'Capture this world to begin production.' };
	const cost = CONFIG.cost[planet.production];
	const progress = Number.isFinite(planet.progress) ? Math.max(0, planet.progress) : 0;
	const percent = Math.min(100, Math.floor(progress / cost * 100));
	const label = productionLabels[planet.production];
	const rate = planet.rate * CONFIG.productionRateMultiplier;
	if (!Number.isFinite(rate) || rate <= 0)
		return { label, percent, secondsRemaining: null, detail: `${label} · production inactive` };
	const secondsRemaining = Math.max(0, cost - progress) / rate;
	return { label, percent, secondsRemaining, detail: `${label} · ${percent}% · next in ${duration(secondsRemaining)} game time` };
};

export const productionSummary = function (worlds: readonly ProductionWorld[]): string {
	const active = worlds.filter(function (planet) { return planet.owner !== 'neutral'; });
	const first = active[0];
	if (!first) return 'No active production';
	if (active.length === 1) return productionEstimate(first).detail;
	const types: readonly Production[] = ['troops', 'ships', 'guns'];
	const groups = types.flatMap(function (production) {
		const count = active.filter(function (planet) { return planet.production === production; }).length;
		return count > 0 ? [`${count} building ${productionLabels[production].toLowerCase()}`] : [];
	});
	return `${groups.length > 1 ? 'Mixed production' : 'Production'} · ${groups.join(' / ')}`;
};

export interface TacticalSource {
	readonly id: number;
	readonly planet: Readonly<Pick<Planet, 'x' | 'y'>>;
	readonly preview: Readonly<ReturnType<typeof previewDispatch>>;
}

export interface ArrivalEstimate {
	readonly earliest: number;
	readonly latest: number;
}

export interface InvasionAssessment {
	readonly title: string;
	readonly detail: string;
	readonly tone: 'neutral' | 'warning';
	readonly troops: number;
	readonly ships: number;
	readonly defenders: number;
	readonly hostileShips: number;
	readonly hostilePlatforms: number;
	/** Approximate arrival at orbit in simulation seconds, excluding combat. */
	readonly shipArrivalSeconds: ArrivalEstimate | null;
	readonly troopArrivalSeconds: ArrivalEstimate | null;
	readonly arrivalText: string;
	readonly caveat: string;
}

interface AssessmentInput {
	readonly target: { readonly id: number; readonly planet: Readonly<Pick<Planet, 'x' | 'y' | 'radius' | 'owner' | 'troops' | 'guns' | 'carrier'>> };
	readonly sources: readonly TacticalSource[];
	/** Living hostile warships in orbit; excludes docked inventory. */
	readonly hostileShips: number;
	readonly side?: Side;
}

const arrivalEstimate = function (
	sources: readonly TacticalSource[],
	target: AssessmentInput['target']['planet'],
	kind: 'ships' | 'troops',
): ArrivalEstimate | null {
	// Carrier courses may change while a player chooses the order. Do not present
	// a static distance as a promised interception time.
	if (target.carrier?.destination) return null;
	const departing = sources.filter(function (source) { return source.preview[kind] > 0; });
	if (departing.length === 0) return null;
	const speed = CONFIG.travelSpeed * (kind === 'troops' ? 0.5 : 1);
	const times = departing.map(function (source) {
		const distance = Math.hypot(target.x - source.planet.x, target.y - source.planet.y);
		return Math.max(0, distance - target.radius - CONFIG.arrivalClearance) / speed;
	});
	return { earliest: Math.min(...times), latest: Math.max(...times) };
};

const arrivalLabel = function (estimate: ArrivalEstimate): string {
	return Math.ceil(estimate.earliest) === Math.ceil(estimate.latest)
		? `~${duration(estimate.latest)}`
		: `~${duration(estimate.earliest)}–${duration(estimate.latest)}`;
};

export const assessInvasion = function (input: AssessmentInput): InvasionAssessment {
	const { target, hostileShips } = input;
	const side = input.side ?? 'blue';
	// dispatchTo skips a source when it is also the destination and deduplicates
	// sources. Match that behavior so a local garrison cannot inflate the preview.
	const sources = input.sources.filter(function (source, index, all) {
		return source.id !== target.id && all.findIndex(function (candidate) { return candidate.id === source.id; }) === index;
	});
	const troops = sources.reduce(function (sum, source) { return sum + source.preview.troops; }, 0);
	const ships = sources.reduce(function (sum, source) { return sum + source.preview.ships; }, 0);
	const defenders = target.planet.troops;
	const hostilePlatforms = isHostile(target.planet.owner, side) ? Math.ceil(target.planet.guns) : 0;
	const landingBlocked = hostileShips > 0 || hostilePlatforms > 0;
	const friendly = target.planet.owner === side;
	const shipArrivalSeconds = arrivalEstimate(sources, target.planet, 'ships');
	const troopArrivalSeconds = arrivalEstimate(sources, target.planet, 'troops');
	const arrivals = [
		...(shipArrivalSeconds ? [`Ships ${arrivalLabel(shipArrivalSeconds)}`] : []),
		...(troopArrivalSeconds ? [`Transports ${arrivalLabel(troopArrivalSeconds)}`] : []),
	];
	const arrivalText = target.planet.carrier?.destination && troops + ships > 0
		? 'Moving carrier · arrival depends on its course'
		: arrivals.length > 0 ? `${arrivals.join(' · ')} to orbit, game time` : 'No departing forces';
	const base = {
		troops, ships, defenders, hostileShips, hostilePlatforms,
		shipArrivalSeconds, troopArrivalSeconds, arrivalText,
		caveat: 'Current forces only. Production, reinforcements and combat can change the outcome and arrival time.',
	};
	if (troops + ships === 0)
		return { ...base, title: 'No forces to send', detail: 'Choose another source, increase the send amount, or check the blockade.', tone: 'warning' };
	if (troops === 0)
		return { ...base, title: friendly ? 'Orbital reinforcement' : 'Ships cannot capture', detail: friendly ? 'Warships reinforce the orbit. They do not add surface troops.' : 'Warships fight in orbit. Send troops to capture the surface.', tone: friendly ? 'neutral' : 'warning' };
	if (landingBlocked)
		return { ...base, title: 'Landing blocked', detail: `${hostileShips} hostile warships · ${hostilePlatforms} hostile platforms. Transports wait until the orbit is clear.${ships === 0 ? ' This order has no escorts.' : ''}`, tone: 'warning' };
	if (friendly)
		return { ...base, title: 'Reinforce this holding', detail: `${troops} troops will attempt to join the ${defenders} already stationed here.`, tone: 'neutral' };
	if (troops <= defenders)
		return { ...base, title: 'More troops needed', detail: `${defenders} defenders now. At least ${defenders + 1} arriving troops are needed to capture; this order sends ${troops}.`, tone: 'warning' };
	return { ...base, title: 'Surface advantage', detail: `${troops} troops against ${defenders} current defenders. No hostile orbital defenses detected.`, tone: 'neutral' };
};
