import { expect, test } from 'bun:test';
import { visibleMapLabels } from './map-labels';

test('crowded labels keep the selected world readable and avoid neighboring counters and HUD', function () {
	const labels = [
		{ key: 'carrier', x: 110, y: 90, width: 80, height: 14, priority: 400 },
		{ key: 'selected', x: 100, y: 90, width: 40, height: 14, priority: 1000 },
		{ key: 'under-counter', x: 30, y: 30, width: 50, height: 14, priority: 100 },
		{ key: 'clear', x: 210, y: 80, width: 40, height: 14, priority: 100 },
	] as const;
	expect([...visibleMapLabels(labels, [{ x: 40, y: 20, width: 20, height: 30 }])]).toEqual(['selected', 'clear']);
	expect(labels[0].key).toBe('carrier');
});
