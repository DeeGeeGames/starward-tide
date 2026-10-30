// Rebuild runtime derivatives; editable Blender and original GLBs stay in docs.
export {};
const sources = [
	{ name: 'warship', path: 'docs/experiments/capital-ship-3d/v3/capital-warship.glb', ratio: 0.2, error: 0.003 },
	{ name: 'warship-overview', path: 'docs/experiments/capital-ship-3d/v3/capital-warship.glb', ratio: 0.03, error: 0.02 },
	...['carrier', 'transport', 'platform'].map(function (name) {
		return { name, path: `docs/experiments/fleet-3d/${name}/${name}.glb`, ratio: 0.65, error: 0.003 };
	}),
];
for (const source of sources) {
	const process = Bun.spawn(['bun', 'x', '@gltf-transform/cli@4.5.1', 'optimize', source.path, `assets/models/${source.name}.glb`,
		'--compress', 'false', '--texture-compress', 'false', '--instance', 'false', '--palette', 'false',
		'--simplify-ratio', String(source.ratio), '--simplify-error', String(source.error)], { stdout: 'inherit', stderr: 'inherit' });
	if (await process.exited !== 0) throw new Error(`Could not prepare ${source.name}`);
}
