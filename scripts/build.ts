import { rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
const result = await Bun.build({
	entrypoints: ['index.html'],
	outdir: 'dist',
	minify: true,
	sourcemap: 'external',
});
if (!result.success)
	throw new AggregateError(result.logs, 'Browser build failed');
