export const CONFIG = {
	step: 0.05,
	travelSpeed: 95,
	dropshipCapacity: 10,
	shipHealth: 6,
	transportHealth: 2,
	shipDamage: 1.8,
	gunHealth: 4,
	gunDamage: 2.4,
	arrivalGrace: 0.75,
	cost: { troops: 1, ships: 6, guns: 5 },
	aiInterval: 2.8,
} as const;

export type Owner = 'blue' | 'red' | 'neutral';
export type Side = Exclude<Owner, 'neutral'>;
export type Production = 'troops' | 'ships' | 'guns';
export type DispatchFilter = 'combined' | 'ships' | 'troops';
export type Scenario = 'skirmish' | 'blockade' | 'invasion';
export const COLORS = {
	blue: '#60d9ff',
	red: '#ff867e',
	neutral: '#8c9baa',
} as const;
