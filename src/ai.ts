import type { Game } from './game';

type AIDependencies = Pick<
	typeof import('./game'),
	'dispatch' | 'isBlockaded' | 'planets' | 'setProduction' | 'shipsAt' | 'units'
>;
type PlanetEntity = ReturnType<AIDependencies['planets']>[number];

// Keep the usual reserve when it already wins. Raise it only when that reserve
// would arrive short of the garrison or the blockading fleet.
const SEND_FRACTION = 0.75;

const distanceBetween = function (
	a: { x: number; y: number },
	b: { x: number; y: number },
): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
};

// dispatch sends ceil(ships * fraction) ships. Pick the smallest fraction that
// releases at least `want` of them.
const shipFraction = function (
	ships: number,
	want: number,
): number | undefined {
	if (want <= 0 || ships < want) return undefined;
	for (let sent = want; sent <= ships; sent++) {
		const fraction = sent / ships;
		if (fraction <= 0 || fraction > 1) continue;
		const released = Math.ceil(ships * fraction);
		if (released >= want && released <= sent) return fraction;
	}
	return undefined;
};

// dispatch sends floor(troops * fraction) troops. Prefer the standard reserve
// when it delivers `minimumCargo`; otherwise send the smallest larger share.
const troopFraction = function (
	troops: number,
	minimumCargo: number,
): number | undefined {
	if (minimumCargo <= 0 || troops < minimumCargo) return undefined;
	if (Math.floor(troops * SEND_FRACTION) >= minimumCargo) return SEND_FRACTION;
	for (let cargo = minimumCargo; cargo <= troops; cargo++) {
		const fraction = cargo / troops;
		if (fraction <= 0 || fraction > 1) continue;
		if (Math.floor(troops * fraction) >= minimumCargo) return fraction;
	}
	return undefined;
};

export const runAI = function (
	world: Game,
	{ dispatch, isBlockaded, planets, setProduction, shipsAt, units }: AIDependencies,
): void {
	const all = planets(world);
	const troopSources = new Set<number>();
	const redPlanets = all.filter(function (entity) {
		return entity.components.planet.owner === 'red';
	});
	const redShips = function (planetId: number): number {
		return shipsAt(world, planetId, 'red').length;
	};
	const blueShips = function (planetId: number): number {
		return shipsAt(world, planetId, 'blue').length;
	};
	// Transports land only after enemy ships are gone, and enemy-owned platforms
	// hold the orbit as well. Neutral platforms do not.
	const landingBlocked = function (entity: PlanetEntity): boolean {
		const planet = entity.components.planet;
		return (
			blueShips(entity.id) > 0 || (planet.owner === 'blue' && planet.guns > 0)
		);
	};
	const inboundCargo = function (planetId: number): number {
		return units(world).reduce(function (sum, entity) {
			const unit = entity.components.unit;
			if (
				unit.owner !== 'red' ||
				unit.kind !== 'transport' ||
				unit.target !== planetId ||
				unit.hp <= 0
			)
				return sum;
			return sum + unit.cargo;
		}, 0);
	};
	const canLaunch = function (entity: PlanetEntity): boolean {
		return !isBlockaded(world, entity.id) && blueShips(entity.id) === 0;
	};
	const byDistance = function (
		target: PlanetEntity,
	): (a: PlanetEntity, b: PlanetEntity) => number {
		return function (a: PlanetEntity, b: PlanetEntity): number {
			const origin = target.components.planet;
			return (
				distanceBetween(a.components.planet, origin) -
					distanceBetween(b.components.planet, origin) || a.id - b.id
			);
		};
	};
	const chooseTarget = function (source: PlanetEntity): PlanetEntity | undefined {
		const origin = source.components.planet;
		return all
			.filter(function (entity) {
				return (
					entity.components.planet.owner !== 'red' &&
					!units(world).some(function (candidate) {
						const unit = candidate.components.unit;
						return (
							unit.owner === 'red' &&
							unit.kind === 'transport' &&
							unit.target === entity.id
						);
					})
				);
			})
			.sort(function (a, b) {
				const score = function (entity: PlanetEntity): number {
					const planet = entity.components.planet;
					return (
						distanceBetween(origin, planet) +
						planet.troops * 5 +
						(planet.owner === 'blue' ? 70 : 0)
					);
				};
				return score(a) - score(b);
			})[0];
	};
	const donors = function (target: PlanetEntity): PlanetEntity[] {
		return redPlanets
			.filter(function (entity) {
				return (
					canLaunch(entity) &&
					!troopSources.has(entity.id) &&
					entity.components.planet.troops > 0
				);
			})
			.sort(byDistance(target));
	};

	for (const source of redPlanets) {
		if (!canLaunch(source)) setProduction(world, [source.id], 'ships', 'red');
	}

	// Equal fleets annihilate. Relief has to arrive with strictly more ships.
	const blockades = redPlanets
		.filter(function (entity) {
			return isBlockaded(world, entity.id);
		})
		.sort(function (a, b) {
			return blueShips(a.id) - blueShips(b.id) || a.id - b.id;
		});
	for (const held of blockades) {
		const need = blueShips(held.id) + 1;
		const contributors = redPlanets
			.filter(function (entity) {
				return (
					entity.id !== held.id && canLaunch(entity) && redShips(entity.id) > 0
				);
			})
			.sort(byDistance(held));
		const available = contributors.reduce(function (sum, entity) {
			return sum + redShips(entity.id);
		}, 0);
		if (available < need) continue;
		let remaining = need;
		for (const contributor of contributors) {
			if (remaining <= 0) break;
			const have = redShips(contributor.id);
			const fraction = shipFraction(have, Math.min(have, remaining));
			if (fraction === undefined) continue;
			remaining -= dispatch(
				world,
				[contributor.id],
				held.id,
				fraction,
				'ships',
				'red',
			);
		}
	}

	const heldOrbits = all
		.filter(function (entity) {
			return (
				entity.components.planet.owner !== 'red' &&
				redShips(entity.id) > 0 &&
				!landingBlocked(entity)
			);
		})
		.sort(function (a, b) {
			return (
				a.components.planet.troops - b.components.planet.troops || a.id - b.id
			);
		});
	for (const target of heldOrbits) {
		const minimum = target.components.planet.troops + 1 - inboundCargo(target.id);
		if (minimum <= 0) continue;
		const eligible = donors(target);
		// One world that can capture alone does so. Pool only when none can.
		const solo = eligible.find(function (source) {
			return (
				troopFraction(source.components.planet.troops, minimum) !== undefined
			);
		});
		if (solo) {
			const fraction = troopFraction(solo.components.planet.troops, minimum);
			if (fraction !== undefined) {
				dispatch(world, [solo.id], target.id, fraction, 'troops', 'red');
				troopSources.add(solo.id);
				continue;
			}
		}
		let mildCover = 0;
		const mild: number[] = [];
		for (const source of eligible) {
			const cargo = Math.floor(source.components.planet.troops * SEND_FRACTION);
			if (cargo <= 0) continue;
			mild.push(source.id);
			mildCover += cargo;
			if (mildCover >= minimum) break;
		}
		if (mildCover >= minimum) {
			dispatch(world, mild, target.id, SEND_FRACTION, 'troops', 'red');
			for (const id of mild) troopSources.add(id);
			continue;
		}
		let fullCover = 0;
		let prefix = 0;
		for (const source of eligible) {
			fullCover += source.components.planet.troops;
			prefix++;
			if (fullCover >= minimum) break;
		}
		if (fullCover < minimum) continue;
		const plan: { id: number; fraction: number }[] = [];
		let pledged = 0;
		let index = 0;
		for (const source of eligible) {
			if (index >= prefix || pledged >= minimum) break;
			const troops = source.components.planet.troops;
			const fraction = troopFraction(
				troops,
				Math.min(troops, minimum - pledged),
			);
			if (fraction === undefined) {
				plan.length = 0;
				break;
			}
			plan.push({ id: source.id, fraction });
			pledged += Math.floor(troops * fraction);
			index++;
		}
		if (pledged < minimum) continue;
		for (const step of plan) {
			dispatch(world, [step.id], target.id, step.fraction, 'troops', 'red');
			troopSources.add(step.id);
		}
	}

	for (const source of redPlanets) {
		if (!canLaunch(source)) continue;
		const target = chooseTarget(source);
		if (!target) continue;
		const planet = source.components.planet;
		const defender = target.components.planet;
		const ships = redShips(source.id);
		// Neutral platforms do not fire or block a landing, so they are not escorts.
		const resistance =
			(defender.owner === 'blue' ? defender.guns : 0) + blueShips(target.id);
		const desiredShips = Math.max(4, Math.ceil(resistance * 1.8) + 2);
		setProduction(
			world,
			[source.id],
			planet.troops >= 24 && ships < desiredShips ? 'ships' : 'troops',
			'red',
		);
		if (troopSources.has(source.id)) continue;
		const fraction = troopFraction(planet.troops, defender.troops + 1);
		const escorted =
			fraction !== undefined &&
			(resistance === 0 || Math.ceil(ships * fraction) > resistance * 1.4);
		if (!landingBlocked(target) && fraction !== undefined && escorted)
			dispatch(world, [source.id], target.id, fraction, 'combined', 'red');
		else if (ships >= Math.max(5, desiredShips))
			dispatch(world, [source.id], target.id, SEND_FRACTION, 'ships', 'red');
	}
};
