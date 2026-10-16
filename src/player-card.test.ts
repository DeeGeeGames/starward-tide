import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const origin = 'https://david0178418.github.io/galaxy-conquest';

const meta = function (attribute: string, name: string): string {
	const pattern = new RegExp(
		`<meta\\s+${attribute}="${name}"\\s+content="([^"]*)"\\s*/?>`,
	);
	const match = pattern.exec(page);
	const content = match?.[1];
	if (content === undefined) throw new Error(`missing ${attribute}=${name}`);
	return content;
};

test('published page is an X player card for the live game', function () {
	expect(page.match(/name="twitter:card"/g)).toHaveLength(1);
	expect(meta('name', 'twitter:card')).toBe('player');
	expect(meta('name', 'twitter:title')).toBe('Galaxy Conquest');
	expect(meta('name', 'twitter:player')).toBe(`${origin}/`);
	expect(meta('name', 'twitter:player:width')).toBe('640');
	expect(meta('name', 'twitter:player:height')).toBe('480');
	expect(meta('name', 'twitter:image')).toBe(`${origin}/x-card.jpg`);
	expect(page).not.toContain('twitter:player:stream');
	expect(meta('property', 'og:url')).toBe(`${origin}/`);
	const poster = readFileSync(new URL('../assets/x-card.jpg', import.meta.url));
	expect(poster.byteLength).toBeGreaterThan(1000);
	expect(poster.subarray(0, 3).toString('hex')).toBe('ffd8ff');
});
