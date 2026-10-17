import type { Owner, Production, Scenario, Side } from './config';
import type {
	Departure,
	Match,
	Notice,
	Order,
	OrderBook,
	Planet,
	Unit,
} from './game';
import type { StarMap, PlanetSeed } from './maps';

export const SAVE_SCHEMA_VERSION = 1;
const MAX_SAVED_STOCK = 100_000;
const MAX_SAVED_CARGO = 100_000;
const MAX_SAVED_PRODUCTION_RATE = 10_000;
const MAX_SAVED_PRODUCTION_PROGRESS = 10_000;
const MAX_SAVED_COORDINATE = 20_000;
const MAX_SAVED_PLANET_RADIUS = 1_000;

export interface GameSnapshot {
	map: StarMap;
	scenario: Scenario;
	pace: 0.5 | 1 | 2;
	match: Omit<Match, 'engagements'>;
	planets: { id: number; planet: Planet }[];
	units: { id: number; unit: Unit }[];
	orderBook: OrderBook;
}

export interface ConquestSave {
	schemaVersion: number;
	profileId: string;
	savedAt: number;
	game: GameSnapshot;
}

const isRecord = function (value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
};
const isFiniteNumber = function (value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
};
const isNonnegativeNumber = function (value: unknown): value is number {
	return isFiniteNumber(value) && value >= 0;
};
const isBoundedCoordinate = function (value: unknown): value is number {
	return isFiniteNumber(value) && Math.abs(value) <= MAX_SAVED_COORDINATE;
};
const isBoundedInteger = function (value: unknown, maximum: number): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value <= maximum
	);
};
const isId = function (value: unknown): value is number {
	return Number.isSafeInteger(value) && typeof value === 'number' && value > 0;
};
const isSide = function (value: unknown): value is Side {
	return value === 'blue' || value === 'red';
};
const isOwner = function (value: unknown): value is Owner {
	return value === 'blue' || value === 'red' || value === 'neutral';
};
const isProduction = function (value: unknown): value is Production {
	return value === 'troops' || value === 'ships' || value === 'guns';
};
const isScenario = function (value: unknown): value is Scenario {
	return value === 'skirmish' || value === 'blockade' || value === 'invasion';
};
const isPlanetSeed = function (value: unknown): value is PlanetSeed {
	return (
		Array.isArray(value) &&
		value.length === 7 &&
		typeof value[0] === 'string' &&
		isNonnegativeNumber(value[1]) &&
		isNonnegativeNumber(value[2]) &&
		isFiniteNumber(value[3]) &&
		value[3] > 0 &&
		value[3] <= MAX_SAVED_PLANET_RADIUS &&
		isOwner(value[4]) &&
		isBoundedInteger(value[5], MAX_SAVED_STOCK) &&
		isFiniteNumber(value[6]) &&
		value[6] >= 0 &&
		value[6] <= MAX_SAVED_PRODUCTION_RATE
	);
};
const isMap = function (value: unknown): value is StarMap {
	if (!isRecord(value)) return false;
	const width = value.width;
	const height = value.height;
	if (
		!isFiniteNumber(width) ||
		width <= 0 ||
		width > 10000 ||
		!isFiniteNumber(height) ||
		height <= 0 ||
		height > 10000 ||
		!Array.isArray(value.planets) ||
		value.planets.length < 2 ||
		value.planets.length > 100
	)
		return false;
	return value.planets.every(function (seed: unknown) {
		return isPlanetSeed(seed) && seed[1] <= width && seed[2] <= height;
	});
};
const isPlanet = function (value: unknown): value is Planet {
	return (
		isRecord(value) &&
		typeof value.name === 'string' &&
		isNonnegativeNumber(value.x) &&
		isNonnegativeNumber(value.y) &&
		isFiniteNumber(value.radius) &&
		value.radius > 0 &&
		value.radius <= MAX_SAVED_PLANET_RADIUS &&
		isOwner(value.owner) &&
		isBoundedInteger(value.troops, MAX_SAVED_STOCK) &&
		isFiniteNumber(value.guns) &&
		value.guns >= 0 &&
		value.guns <= MAX_SAVED_STOCK &&
		isFiniteNumber(value.rate) &&
		value.rate >= 0 &&
		value.rate <= MAX_SAVED_PRODUCTION_RATE &&
		isProduction(value.production) &&
		isNonnegativeNumber(value.progress) &&
		value.progress < MAX_SAVED_PRODUCTION_PROGRESS
	);
};
const isUnit = function (value: unknown): value is Unit {
	return (
		isRecord(value) &&
		isSide(value.owner) &&
		(value.kind === 'ship' || value.kind === 'transport') &&
		isBoundedCoordinate(value.x) &&
		isBoundedCoordinate(value.y) &&
		isId(value.target) &&
		(value.phase === 'travel' || value.phase === 'orbit') &&
		isFiniteNumber(value.hp) &&
		value.hp > 0 &&
		value.hp <= 10000 &&
		isBoundedInteger(value.cargo, MAX_SAVED_CARGO) &&
		(value.kind === 'transport' || value.cargo === 0) &&
		isNonnegativeNumber(value.age)
	);
};
const isNotice = function (value: unknown): value is Notice {
	return (
		isRecord(value) &&
		typeof value.text === 'string' &&
		isNonnegativeNumber(value.time) &&
		isOwner(value.side)
	);
};
const isMatchSnapshot = function (
	value: unknown,
): value is Omit<Match, 'engagements'> {
	return (
		isRecord(value) &&
		isNonnegativeNumber(value.time) &&
		typeof value.paused === 'boolean' &&
		(value.winner === null || isSide(value.winner)) &&
		typeof value.ai === 'boolean' &&
		isNonnegativeNumber(value.aiClock) &&
		Number.isSafeInteger(value.orders) &&
		typeof value.orders === 'number' &&
		value.orders >= 0 &&
		Number.isSafeInteger(value.captures) &&
		typeof value.captures === 'number' &&
		value.captures >= 0 &&
		Number.isSafeInteger(value.transportsLost) &&
		typeof value.transportsLost === 'number' &&
		value.transportsLost >= 0 &&
		Number.isSafeInteger(value.troopsLost) &&
		typeof value.troopsLost === 'number' &&
		value.troopsLost >= 0 &&
		(value.firstCapture === null ||
			(isNonnegativeNumber(value.firstCapture) && value.firstCapture <= value.time)) &&
		Array.isArray(value.notices) &&
		value.notices.length <= 100 &&
		value.notices.every(isNotice)
	);
};
const isDeparture = function (value: unknown): value is Departure {
	return (
		isRecord(value) &&
		isId(value.unitId) &&
		isId(value.source) &&
		isBoundedCoordinate(value.x) &&
		isBoundedCoordinate(value.y) &&
		isNonnegativeNumber(value.age)
	);
};
const isOrder = function (value: unknown): value is Order {
	return (
		isRecord(value) &&
		isId(value.id) &&
		isSide(value.owner) &&
		isId(value.target) &&
		(value.state === 'pending' ||
			value.state === 'outbound' ||
			value.state === 'returning') &&
		Array.isArray(value.departures) &&
		value.departures.length <= 10000 &&
		value.departures.every(isDeparture)
	);
};
const sameSeedGeometry = function (planet: Planet, seed: PlanetSeed): boolean {
	return (
		planet.name === seed[0] &&
		planet.x === seed[1] &&
		planet.y === seed[2] &&
		planet.radius === seed[3] &&
		planet.rate === seed[6]
	);
};
const hasUniqueIds = function (
	items: readonly { id: number }[],
	seen: Set<number>,
): boolean {
	for (const item of items) {
		if (!isId(item.id) || seen.has(item.id)) return false;
		seen.add(item.id);
	}
	return true;
};
const isGameSnapshot = function (value: unknown): value is GameSnapshot {
	if (
		!isRecord(value) ||
		!isMap(value.map) ||
		!isScenario(value.scenario) ||
		(value.pace !== 0.5 && value.pace !== 1 && value.pace !== 2) ||
		!isMatchSnapshot(value.match) ||
		!isRecord(value.orderBook) ||
		!isId(value.orderBook.nextId) ||
		!Array.isArray(value.planets) ||
		value.planets.length !== value.map.planets.length ||
		value.planets.some(function (entry) {
			return !isRecord(entry) || !isId(entry.id) || !isPlanet(entry.planet);
		}) ||
		!Array.isArray(value.units) ||
		value.units.length > 10000 ||
		value.units.some(function (entry) {
			return !isRecord(entry) || !isId(entry.id) || !isUnit(entry.unit);
		}) ||
		!Array.isArray(value.orderBook.active) ||
		value.orderBook.active.length > 10000 ||
		!value.orderBook.active.every(isOrder)
	)
		return false;

	const planetRows = value.planets.filter(function (
		entry,
	): entry is { id: number; planet: Planet } {
		return isRecord(entry) && isId(entry.id) && isPlanet(entry.planet);
	});
	const unitRows = value.units.filter(function (
		entry,
	): entry is { id: number; unit: Unit } {
		return isRecord(entry) && isId(entry.id) && isUnit(entry.unit);
	});
	const allIds = new Set<number>();
	if (!hasUniqueIds(planetRows, allIds) || !hasUniqueIds(unitRows, allIds)) return false;
	const planetsByName = new Map(
		planetRows.map(function (entry) {
			return [entry.planet.name, entry.planet] as const;
		}),
	);
	if (
		planetsByName.size !== planetRows.length ||
		!value.map.planets.every(function (seed) {
			const current = planetsByName.get(seed[0]);
			return current !== undefined && sameSeedGeometry(current, seed);
		})
	)
		return false;
	const planetIds = new Set(planetRows.map(function (entry) {
		return entry.id;
	}));
	const orderBook = value.orderBook;
	if (
		!isRecord(orderBook) ||
		!isId(orderBook.nextId) ||
		!Array.isArray(orderBook.active)
	)
		return false;
	const nextOrderId = orderBook.nextId;
	const activeOrders = orderBook.active.filter(isOrder);
	const unitsById = new Map(unitRows.map(function (entry) {
		return [entry.id, entry.unit] as const;
	}));
	if (
		unitRows.some(function (entry) {
			return !planetIds.has(entry.unit.target);
		})
	)
		return false;
	const orderIds = new Set<number>();
	const assignedUnits = new Set<number>();
	if (
		activeOrders.some(function (order) {
			if (
				orderIds.has(order.id) ||
				order.id >= nextOrderId ||
				!planetIds.has(order.target)
			)
				return true;
			orderIds.add(order.id);
			return order.departures.some(function (departure) {
				if (
					!planetIds.has(departure.source) ||
					assignedUnits.has(departure.unitId)
				)
					return true;
				assignedUnits.add(departure.unitId);
				const unit = unitsById.get(departure.unitId);
				if (!unit) return true;
				const expectedTarget =
					order.state === 'returning' ? departure.source : order.target;
				return unit.owner !== order.owner || unit.target !== expectedTarget;
			});
		})
	)
		return false;
	return true;
};

export class InvalidSaveError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidSaveError';
	}
}

const isConquestSave = function (
	value: unknown,
	expectedProfileId?: string,
): value is ConquestSave {
	return (
		isRecord(value) &&
		value.schemaVersion === SAVE_SCHEMA_VERSION &&
		typeof value.profileId === 'string' &&
		value.profileId.length > 0 &&
		(expectedProfileId === undefined || value.profileId === expectedProfileId) &&
		isFiniteNumber(value.savedAt) &&
		value.savedAt > 0 &&
		isGameSnapshot(value.game)
	);
};

const migrateSave = function (value: unknown): unknown {
	if (!isRecord(value) || typeof value.schemaVersion !== 'number')
		throw new InvalidSaveError('This saved conquest is missing its format version.');
	const current: unknown = value;
	const version = value.schemaVersion;
	if (!Number.isSafeInteger(version) || version < 1)
		throw new InvalidSaveError('This saved conquest has an invalid format version.');
	while (version < SAVE_SCHEMA_VERSION) {
		switch (version) {
			// Add explicit version-to-version conversions here when the save format changes.
			default:
				throw new InvalidSaveError('This saved conquest version cannot be migrated.');
		}
	}
	if (version > SAVE_SCHEMA_VERSION)
		throw new InvalidSaveError(
			'This saved conquest was created by a newer game version. Keep its profile and open it with that version.',
		);
	return current;
};

export const parseConquestSave = function (
	input: unknown,
	expectedProfileId?: string,
): ConquestSave {
	const value = migrateSave(input);
	if (!isConquestSave(value, expectedProfileId))
		throw new InvalidSaveError(
			'Could not validate this saved conquest. Its profile data was kept unchanged.',
		);
	return value;
};

export const isSupportedConquestSave = function (
	input: unknown,
	expectedProfileId?: string,
): boolean {
	try {
		parseConquestSave(input, expectedProfileId);
		return true;
	} catch {
		return false;
	}
};
