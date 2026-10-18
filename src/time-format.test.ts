import { expect, test } from 'bun:test';
import { formatElapsedTime } from './time-format';

test('formats elapsed time as zero-padded minutes and seconds', function () {
	expect(formatElapsedTime(0)).toBe('00:00');
	expect(formatElapsedTime(9)).toBe('00:09');
	expect(formatElapsedTime(59.9)).toBe('00:59');
	expect(formatElapsedTime(60)).toBe('01:00');
	expect(formatElapsedTime(125.4)).toBe('02:05');
});
