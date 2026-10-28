export const MAP = { width: 1200, height: 1320 } as const;

export const CONFIG = {
	step: 0.05,
	travelSpeed: 23.75,
	dropshipCapacity: 10,
	shipHealth: 6,
	transportHealth: 2,
	shipDamage: 1.8,
	gunHealth: 4,
	gunDamage: 2.4,
	arrivalClearance: 22,
	engagementRange: 48,
	arrivalGrace: 0.75,
	bombardmentCharge: 20,
	productionRateMultiplier: 0.125,
	cost: { troops: 1, ships: 6, guns: 5 },
	aiInterval: 2.8,
} as const;

export const SIDES = ['blue', 'red', 'green', 'purple'] as const;
export type Owner = typeof SIDES[number] | 'neutral';
export const isHostile = function (a: Owner, b: Owner): boolean {
	return a !== 'neutral' && b !== 'neutral' && a !== b;
};
export const factionLabel = function (owner: Owner): string {
	return owner === 'blue' ? 'You' : owner === 'neutral' ? 'Neutral' : `${owner[0]?.toUpperCase()}${owner.slice(1)} rival`;
};
export type Side = Exclude<Owner, 'neutral'>;
export type Production = 'troops' | 'ships' | 'guns';
export type DispatchFilter = 'combined' | 'ships' | 'troops';
export type Scenario = 'skirmish' | 'blockade' | 'invasion';
export const COLORS = {
	blue: '#60d9ff',
	red: '#ff867e',
	green: '#8ee28a',
	purple: '#c6a0ff',
	neutral: '#8c9baa',
} as const;
