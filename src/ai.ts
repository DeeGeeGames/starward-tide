import type { Game } from './game';

type AIDependencies = Pick<
	typeof import('./game'),
	'dispatch' | 'isBlockaded' | 'planets' | 'setProduction' | 'shipsAt' | 'units'
>;

export const runAI = function (
	world: Game,
	{ dispatch, isBlockaded, planets, setProduction, shipsAt, units }: AIDependencies,
): void {
	const all = planets(world);
	for (const source of all.filter(function (e) {
		return e.components.planet.owner === 'red';
	})) {
		const p = source.components.planet;
		const ships = shipsAt(world, source.id, 'red').length;
		const hostile = shipsAt(world, source.id, 'blue').length;
		if (isBlockaded(world, source.id)) {
			setProduction(world, [source.id], 'ships', 'red');
			continue;
		}
		const target = all
			.filter(function (e) {
				return (
					e.components.planet.owner !== 'red' &&
					!units(world).some(function (u) {
						return (
							u.components.unit.owner === 'red' &&
							u.components.unit.kind === 'transport' &&
							u.components.unit.target === e.id
						);
					})
				);
			})
			.sort(function (a, b) {
				const score = function (e: typeof a): number {
					const t = e.components.planet;
					return (
						Math.hypot(p.x - t.x, p.y - t.y) +
						t.troops * 5 +
						(t.owner === 'blue' ? 70 : 0)
					);
				};
				return score(a) - score(b);
			})[0];
		if (!target) continue;
		const t = target.components.planet;
		const resistance = t.guns + shipsAt(world, target.id, 'blue').length;
		const desiredShips = Math.max(4, Math.ceil(resistance * 1.8) + 2);
		setProduction(
			world,
			[source.id],
			hostile > 0 || (p.troops >= 24 && ships < desiredShips)
				? 'ships'
				: 'troops',
			'red',
		);
		if (
			p.troops > t.troops + 10 &&
			(resistance === 0 || Math.ceil(ships * 0.75) > resistance * 1.4)
		) {
			dispatch(world, [source.id], target.id, 0.75, 'combined', 'red');
		} else if (ships >= Math.max(5, desiredShips))
			dispatch(world, [source.id], target.id, 0.75, 'ships', 'red');
	}
	// Redirect surviving blockaders when their planet becomes friendly; otherwise send invasions to them.
	for (const source of all.filter(function (e) {
		return (
			e.components.planet.owner !== 'red' &&
			shipsAt(world, e.id, 'red').length > 0
		);
	})) {
		const target = all.find(function (e) {
			return (
				e.components.planet.owner === 'red' &&
				e.components.planet.troops > source.components.planet.troops + 10 &&
				!isBlockaded(world, e.id)
			);
		});
		if (target) dispatch(world, [target.id], source.id, 0.75, 'troops', 'red');
	}
};
