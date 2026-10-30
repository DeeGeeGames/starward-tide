import { expect, test } from 'bun:test';
import { createSpaceLines } from './space-lines';

test('growing line buffers disposes the previously uploaded attributes before replacement', function () {
	const lines = createSpaceLines(0.6);
	try {
		lines.line({ x: 0, y: 0 }, { x: 1, y: 1 }, '#fff'); lines.flush();
		const geometry = lines.object.geometry;
		const original = geometry.getAttribute('position');
		let disposedAttribute = original;
		let disposals = 0;
		geometry.addEventListener('dispose', function () { disposals++; disposedAttribute = geometry.getAttribute('position'); });
		lines.clear();
		for (let i = 0; i < 300; i++) lines.line({ x: 0, y: i }, { x: 2, y: i }, '#fff');
		lines.flush();
		expect(disposals).toBe(1);
		expect(disposedAttribute).toBe(original);
		expect(geometry.getAttribute('position')).not.toBe(original);
		expect(geometry.drawRange.count).toBe(600);
		lines.clear(); lines.flush();
		expect(disposals).toBe(1);
		expect(geometry.drawRange.count).toBe(0);
	} finally { lines.dispose(); }
});
