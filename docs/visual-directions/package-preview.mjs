import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const proofPath = join(root, 'asset-proof', 'index.html');
const source = await readFile(proofPath, 'utf8');
let standalone = source;
for (const name of ['planet-surface.png', 'atlas-warship.png']) {
	const needle = 'src="' + name + '"';
	if (!standalone.includes(needle)) throw new Error('Missing proof input: ' + name);
	const image = await readFile(join(root, 'asset-proof', name));
	standalone = standalone.replace(needle, 'src="data:image/png;base64,' + image.toString('base64') + '"');
}

// Add export controls only to the packaged viewer, preserving the accepted source proof.
const toolbarEnd = '</div>\n<canvas id="scene"';
if (!standalone.includes(toolbarEnd)) throw new Error('Proof toolbar marker changed');
standalone = standalone.replace(toolbarEnd,
	'<button id="export-planet" type="button">Save planet PNG</button>\n' +
	'<button id="export-ship" type="button">Save ship PNG</button>\n' + toolbarEnd);
const marker = '\t// Meaningful bounded checks on the generated assets and motion junction.';
if (!standalone.includes(marker)) throw new Error('Proof export insertion marker changed');
const exportHook = [
	'\tconst downloadPng = function (canvas, filename) {',
	'\t\tconst anchor = document.createElement("a");',
	'\t\tanchor.download = filename;',
	'\t\tanchor.href = canvas.toDataURL("image/png");',
	'\t\tanchor.click();',
	'\t};',
	'\tgetElement("export-planet", HTMLButtonElement).addEventListener("click", function () {',
	'\t\trenderGlobe(0);',
	'\t\tdownloadPng(globe, "planet-frame.png");',
	'\t\trenderGlobe(seconds);',
	'\t});',
	'\tgetElement("export-ship", HTMLButtonElement).addEventListener("click", function () {',
	'\t\tconst normalized = document.createElement("canvas");',
	'\t\tnormalized.width = 256; normalized.height = 256;',
	'\t\tdrawHull(getContext(normalized), 128, 128, 224, 0);',
	'\t\tdownloadPng(normalized, "warship-sprite.png");',
	'\t});',
	''
].join('\n');
standalone = standalone.replace(marker, exportHook + marker);
await writeFile(join(root, 'asset-proof', 'standalone.html'), standalone);

const enumerate = async function (folder) {
	const entries = await readdir(folder, { withFileTypes: true });
	const files = [];
	for (const entry of entries.sort(function (a, b) { return a.name.localeCompare(b.name, 'en'); })) {
		const path = join(folder, entry.name);
		if (entry.isDirectory()) files.push(...await enumerate(path));
		else if (entry.isFile() && entry.name !== 'manifest.json') files.push(path);
		else if (!entry.isFile()) throw new Error('Unexpected non-file input: ' + path);
	}
	return files;
};
const files = [];
for (const path of await enumerate(root)) {
	const bytes = await readFile(path);
	const record = { path: relative(root, path).split('\\').join('/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
	if (path.endsWith('.png')) {
		if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG: ' + path);
		files.push({ ...record, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
	} else files.push(record);
}
await writeFile(join(root, 'manifest.json'), JSON.stringify({ version: 1, files }, null, '\t') + '\n');
console.log('Packaged offline proof and checksums for ' + files.length + ' reference files.');

