import type { Scenario } from './config';
import type { Game } from './game';
import { orderUnits, planets, units } from './game';
import type { StarMap } from './maps';
import { SAVE_SCHEMA_VERSION } from './save-state';
import type { ConquestSave, GameSnapshot } from './save-state';

export const captureConquestSave = function (
	world: Game,
	map: StarMap,
	scenario: Scenario,
	pace: GameSnapshot['pace'],
	profileId: string,
	savedAt = Date.now(),
): ConquestSave {
	const match = world.getResource('match');
	const orderBook = world.getResource('orderBook');
	const activeOrders = orderBook.active.flatMap(function (order) {
		const memberIds = new Set(
			orderUnits(world, order).map(function (entity) {
				return entity.id;
			}),
		);
		if (memberIds.size === 0) return [];
		const departures = order.departures
			.filter(function (departure) {
				return memberIds.has(departure.unitId);
			})
			.map(function (departure) {
				return structuredClone(departure);
			});
		if (departures.length === 0) return [];
		return [{ ...structuredClone(order), departures }];
	});
	const game: GameSnapshot = {
		map: structuredClone(map),
		scenario,
		pace,
		match: {
			time: match.time,
			paused: match.paused,
			winner: match.winner,
			ai: match.ai,
			aiClock: match.aiClock,
			orders: match.orders,
			captures: match.captures,
			transportsLost: match.transportsLost,
			troopsLost: match.troopsLost,
			firstCapture: match.firstCapture,
			notices: structuredClone(match.notices),
		},
		planets: planets(world).map(function (entity) {
			return { id: entity.id, planet: structuredClone(entity.components.planet) };
		}),
		units: units(world).map(function (entity) {
			return { id: entity.id, unit: structuredClone(entity.components.unit) };
		}),
		orderBook: {
			nextId: orderBook.nextId,
			active: activeOrders,
		},
	};
	return {
		schemaVersion: SAVE_SCHEMA_VERSION,
		profileId,
		savedAt,
		game,
	};
};
