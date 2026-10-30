import { expect, test } from 'bun:test';
import { Box3, Group, Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareModel } from './fleet-models';

for (const kind of ['warship', 'warship-overview', 'carrier', 'transport', 'platform']) {
	test(`${kind} ships as a static, bounded, faction-tintable GLB without external dependencies`, async function () {
		const file = Bun.file(new URL(`../assets/models/${kind}.glb`, import.meta.url));
		const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '');
		expect(gltf.animations).toHaveLength(0);
		const before = new Box3().setFromObject(gltf.scene);
		const parts = prepareModel(gltf.scene);
		const normalized = new Group();
		let triangles = 0;
		try {
			for (const part of parts) {
				normalized.add(new Mesh(part.geometry, part.material));
				const position = part.geometry.getAttribute('position');
				for (let i = 0; i < position.count; i++) {
					expect(Number.isFinite(position.getX(i)) && Number.isFinite(position.getY(i)) && Number.isFinite(position.getZ(i))).toBe(true);
				}
				triangles += (part.geometry.index?.count ?? position.count) / 3;
			}
			expect(parts.some(function (part) { return part.accent; })).toBe(true);
			expect(parts.length).toBeLessThanOrEqual(8);
			expect(triangles).toBeLessThanOrEqual(kind === 'warship' ? 7000 : kind === 'warship-overview' ? 3000 : 4000);
			const bounds = new Box3().setFromObject(normalized);
			expect(bounds.getSize(new Vector3()).x).toBeCloseTo(1, 6);
			expect(bounds.getCenter(new Vector3()).length()).toBeLessThan(0.000001);
			expect(new Box3().setFromObject(gltf.scene).equals(before)).toBe(true);
		} finally {
			for (const part of parts) { part.geometry.dispose(); part.material.dispose(); }
			gltf.scene.traverse(function (object) {
				if (!(object instanceof Mesh)) return;
				object.geometry.dispose();
				for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
			});
		}
	});
}

test('empty or malformed model bounds fail before producing GPU geometry', function () {
	expect(function () { prepareModel(new Group()); }).toThrow('finite, nonzero bounds');
});
