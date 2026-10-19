/** Planet-level campaign balances. These are arithmetic inputs, not save contracts. */
export interface PointBalance {
	readonly planetId: string;
	readonly systemId: string;
	readonly factionId: string | null;
	readonly points: number;
}

export interface PointContribution {
	readonly planetId: string;
	readonly points: number;
}

export interface PointCommitment {
	readonly balances: readonly PointBalance[];
	readonly debits: readonly PointContribution[];
	readonly totalPoints: number;
}

const requireId = function (value: string): void {
	if (!value.trim()) throw new Error('Point identities must not be empty.');
};

const requireBalance = function (value: number): void {
	if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
		throw new Error('Balances must be finite nonnegative numbers within the safe range.');
};

/** Validate and return a planet balance without applying a gameplay ceiling. */
export const availablePoints = function (points: number): number {
	requireBalance(points);
	return points;
};

export const creditPoints = function (points: number, credit: number): number {
	requireBalance(points);
	requireBalance(credit);
	const result = points + credit;
	requireBalance(result);
	return result;
};

const requirePoints = function (value: number): void {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new Error('Committed points must be nonnegative safe integers.');
};

/** Validate the complete debit before constructing any updated balances. */
export const commitPoints = function (
	balances: readonly PointBalance[],
	sourceSystemId: string,
	factionId: string,
	contributions: readonly PointContribution[],
): PointCommitment {
	requireId(sourceSystemId);
	requireId(factionId);
	const byId = new Map<string, PointBalance>();
	for (const balance of balances) {
		requireId(balance.planetId);
		requireId(balance.systemId);
		if (balance.factionId !== null) requireId(balance.factionId);
		requireBalance(balance.points);
		if (byId.has(balance.planetId)) throw new Error('Duplicate planetary balance.');
		byId.set(balance.planetId, balance);
	}
	const debits = new Map<string, number>();
	let totalPoints = 0;
	for (const contribution of contributions) {
		requireId(contribution.planetId);
		requirePoints(contribution.points);
		if (debits.has(contribution.planetId)) throw new Error('Duplicate planetary contribution.');
		const balance = byId.get(contribution.planetId);
		if (!balance) throw new Error('The contributing planet does not exist.');
		if (balance.systemId !== sourceSystemId)
			throw new Error('Contributions must come from the source system.');
		if (balance.factionId !== factionId)
			throw new Error('Contributions must come from owned planets.');
		if (contribution.points > balance.points)
			throw new Error('The contribution exceeds available planetary points.');
		totalPoints += contribution.points;
		requirePoints(totalPoints);
		debits.set(contribution.planetId, contribution.points);
	}
	return {
		balances: balances.map(function (balance) {
			const points = balance.points - (debits.get(balance.planetId) ?? 0);
			requireBalance(points);
			return { ...balance, points };
		}),
		debits: contributions.map(function (contribution) { return { ...contribution }; }),
		totalPoints,
	};
};
