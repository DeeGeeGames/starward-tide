export interface LabelBounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}
export interface MapLabel extends LabelBounds {
	readonly key: string;
	readonly priority: number;
}
const overlaps = function (a: LabelBounds, b: LabelBounds): boolean {
	return a.x < b.x + b.width + 3 && a.x + a.width + 3 > b.x && a.y < b.y + b.height + 3 && a.y + a.height + 3 > b.y;
};

// Prefer selected and owned labels; crowded names remain accessible by inspection/focus.
export const visibleMapLabels = function (labels: readonly MapLabel[], reserved: readonly LabelBounds[]): ReadonlySet<string> {
	const occupied = [...reserved];
	const visible = new Set<string>();
	for (const label of [...labels].sort(function (a, b) { return b.priority - a.priority || a.key.localeCompare(b.key); })) {
		if (occupied.some(function (box) { return overlaps(label, box); })) continue;
		occupied.push(label);
		visible.add(label.key);
	}
	return visible;
};
