import type { Owner } from './config';

// Presentation palette only. Persisted faction IDs and simulation colors stay intact.
export const ATLAS_COLORS: Readonly<Record<Owner, string>> = {
	blue: '#08747d',
	red: '#b44328',
	green: '#39704a',
	purple: '#73518c',
	neutral: '#747367',
};
