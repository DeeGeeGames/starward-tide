import { expect, test } from 'bun:test';
import { availablePoints, commitPoints, creditPoints } from './campaign-points';
import type { PointBalance } from './campaign-points';

const balances: readonly PointBalance[] = Object.freeze([
	Object.freeze({ planetId: 'a', systemId: 'home', factionId: 'blue', points: 100.5 }),
	Object.freeze({ planetId: 'b', systemId: 'home', factionId: 'blue', points: 40 }),
	Object.freeze({ planetId: 'c', systemId: 'away', factionId: 'blue', points: 30 }),
	Object.freeze({ planetId: 'd', systemId: 'home', factionId: 'red', points: 20 }),
	Object.freeze({ planetId: 'e', systemId: 'home', factionId: null, points: 10 }),
]);

test('commitments debit partial and full contributions without changing inputs', function () {
	const contributions = Object.freeze([
		Object.freeze({ planetId: 'a', points: 30 }),
		Object.freeze({ planetId: 'b', points: 40 }),
	]);
	const committed = commitPoints(balances, 'home', 'blue', contributions);
	expect(committed.totalPoints).toBe(70);
	expect(committed.debits).toEqual(contributions);
	expect(committed.balances.map(function (balance) { return availablePoints(balance.points); }))
		.toEqual([70.5, 0, 30, 20, 10]);
	expect(balances[0]?.points).toBe(100.5);
	expect(committed.debits[0]).not.toBe(contributions[0]);
	expect(committed.balances[2]).not.toBe(balances[2]);
});

test('successive commitments use reduced balances and retain fractions', function () {
	const first = commitPoints(balances, 'home', 'blue', [{ planetId: 'a', points: 100 }]);
	expect(function () {
		commitPoints(first.balances, 'home', 'blue', [{ planetId: 'a', points: 1 }]);
	}).toThrow();
	const second = commitPoints(first.balances, 'home', 'blue', [{ planetId: 'a', points: 0 }]);
	expect(second.balances[0]?.points).toBe(0.5);
	expect(second.totalPoints).toBe(0);
});

test('a later invalid contribution rejects the entire commitment', function () {
	expect(function () {
		commitPoints(balances, 'home', 'blue', [{ planetId: 'a', points: 50 }, { planetId: 'b', points: 41 }]);
	}).toThrow();
	expect(balances[0]?.points).toBe(100.5);
});

test('contributions reject foreign systems, foreign ownership, neutral and missing planets', function () {
	for (const planetId of ['c', 'd', 'e', 'missing', '']) {
		expect(function () { commitPoints(balances, 'home', 'blue', [{ planetId, points: 0 }]); }).toThrow();
	}
	expect(function () { commitPoints(balances, '', 'blue', []); }).toThrow();
	expect(function () { commitPoints(balances, 'home', ' ', []); }).toThrow();
});

test('duplicate identities and contributions cannot mask overspending', function () {
	expect(function () { commitPoints([...balances, ...balances], 'home', 'blue', []); }).toThrow();
	expect(function () {
		commitPoints(balances, 'home', 'blue', [{ planetId: 'a', points: 60 }, { planetId: 'a', points: 60 }]);
	}).toThrow();
});

test('whole-point contributions reject fractions and unsafe aggregate spending', function () {
	for (const points of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		expect(function () { commitPoints(balances, 'home', 'blue', [{ planetId: 'a', points }]); }).toThrow();
	}
	const large = balances.slice(0, 2).map(function (balance) {
		return { ...balance, points: Number.MAX_SAFE_INTEGER };
	});
	expect(function () {
		commitPoints(large, 'home', 'blue', large.map(function (balance) {
			return { planetId: balance.planetId, points: balance.points };
		}));
	}).toThrow();
});

test('balances and refunds accept fractions but reject unsafe arithmetic', function () {
	expect(availablePoints(10.25)).toBe(10.25);
	expect(creditPoints(10.25, 0.5)).toBe(10.75);
	for (const invalid of [-1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		expect(function () { availablePoints(invalid); }).toThrow();
		expect(function () { creditPoints(1, invalid); }).toThrow();
	}
	expect(function () { creditPoints(Number.MAX_SAFE_INTEGER, 1); }).toThrow();
});
