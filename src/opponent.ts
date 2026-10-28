import { CONFIG } from './config';

export const DIFFICULTIES = {
	relaxed: {
		label: 'Relaxed',
		detail: 'Slower decisions and larger attack margins.',
		interval: CONFIG.aiInterval * 2,
		troopMargin: 10,
		fleetMargin: 2.2,
		escortMargin: 1.8,
	},
	standard: {
		label: 'Standard',
		detail: 'Normal decisions and attack margins.',
		interval: CONFIG.aiInterval,
		troopMargin: 1,
		fleetMargin: 1.8,
		escortMargin: 1.4,
	},
	hard: {
		label: 'Hard',
		detail: 'Faster decisions and leaner attacking fleets.',
		interval: CONFIG.aiInterval / 2,
		troopMargin: 1,
		fleetMargin: 1.5,
		escortMargin: 1.2,
	},
} as const;
export const STYLES = {
	expansionist: {
		label: 'Expansionist',
		detail: 'Favors neutral worlds before attacking rivals.',
		playerTargetPenalty: 70,
		platforms: 0,
	},
	aggressive: {
		label: 'Aggressive',
		detail: 'Favors rival worlds and applies early pressure.',
		playerTargetPenalty: -250,
		platforms: 0,
	},
	defensive: {
		label: 'Defensive',
		detail: 'Builds two platforms per world before expanding; strongly favors neutral worlds.',
		playerTargetPenalty: 250,
		platforms: 2,
	},
} as const;
export type OpponentDifficulty = keyof typeof DIFFICULTIES;
export type OpponentStyle = keyof typeof STYLES;
export type OpponentStyleChoice = OpponentStyle | 'random';
export interface OpponentSettings {
	readonly difficulty: OpponentDifficulty;
	readonly style: OpponentStyle;
}
export const DEFAULT_OPPONENT: OpponentSettings = { difficulty: 'standard', style: 'expansionist' };
export const isOpponentDifficulty = function (value: unknown): value is OpponentDifficulty {
	return value === 'relaxed' || value === 'standard' || value === 'hard';
};
export const isOpponentStyleChoice = function (value: unknown): value is OpponentStyleChoice {
	return value === 'expansionist' || value === 'aggressive' || value === 'defensive' || value === 'random';
};
export const resolveOpponent = function (
	difficulty: OpponentDifficulty,
	style: OpponentStyleChoice,
): OpponentSettings {
	if (style !== 'random') return { difficulty, style };
	const value = crypto.getRandomValues(new Uint32Array(1))[0];
	if (value === undefined) throw new Error('Could not choose an opponent style');
	const styles = ['expansionist', 'aggressive', 'defensive'] as const;
	const resolved = styles[value % styles.length];
	if (resolved === undefined) throw new Error('Could not choose an opponent style');
	return { difficulty, style: resolved };
};
export const opponentLabel = function (opponent: OpponentSettings): string {
	return `${DIFFICULTIES[opponent.difficulty].label} · ${STYLES[opponent.style].label}`;
};
