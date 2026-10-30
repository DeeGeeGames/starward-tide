import { Box3, BufferGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { COLORS, type Owner } from './config';
import type { Point } from './camera';
import warshipUrl from '../assets/models/warship.glb';
import warshipOverviewUrl from '../assets/models/warship-overview.glb';
import transportUrl from '../assets/models/transport.glb';
import carrierUrl from '../assets/models/carrier.glb';
import platformUrl from '../assets/models/platform.glb';

export const MODEL_URLS = { ship: warshipUrl, shipOverview: warshipOverviewUrl, transport: transportUrl, carrier: carrierUrl, platform: platformUrl } as const;
export type FleetModelKind = Exclude<keyof typeof MODEL_URLS, 'shipOverview'>;
export interface ModelInstance extends Point {
	readonly heading: number;
	readonly owner: Owner;
	readonly length: number;
}
interface Primitive {
	geometry: BufferGeometry;
	material: MeshStandardMaterial;
	accent: boolean;
}
interface FleetModelInspection { batches: number; primitives: number }
interface FleetModels {
	batch(kind: FleetModelKind, instances: readonly ModelInstance[], overview?: boolean): Group;
	inspect(): FleetModelInspection;
	dispose(): void;
}

// Bake source hierarchy transforms and normalize the authored +X hull length.
// All instances share these prepared geometries and materials across factions.
export const prepareModel = function (source: Object3D): Primitive[] {
	source.updateMatrixWorld(true);
	const bounds = new Box3().setFromObject(source);
	const size = bounds.getSize(new Vector3());
	const center = bounds.getCenter(new Vector3());
	if (![size.x, size.y, size.z].every(Number.isFinite) || Math.min(size.x, size.y, size.z) <= 0)
		throw new Error('Fleet model must have finite, nonzero bounds');
	const normalize = new Matrix4().makeScale(1 / size.x, 1 / size.x, 1 / size.x)
		.multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z));
	const primitives: Primitive[] = [];
	source.traverse(function (object) {
		if (!(object instanceof Mesh)) return;
		if (!(object.geometry instanceof BufferGeometry) || !(object.material instanceof MeshStandardMaterial))
			throw new Error('Fleet model requires static, single-material mesh primitives');
		const geometry = object.geometry.clone().applyMatrix4(new Matrix4().multiplyMatrices(normalize, object.matrixWorld));
		geometry.computeBoundingSphere();
		const material = object.material.clone();
		const accent = material.name.startsWith('Faction');
		if (accent) {
			material.color.set('#ffffff');
			material.emissive.set('#ffffff');
			material.emissiveIntensity = 0.2;
		}
		primitives.push({ geometry, material, accent });
	});
	if (primitives.length === 0) throw new Error('Fleet model contains no renderable meshes');
	return primitives;
};

export const loadFleetModels = async function (): Promise<FleetModels> {
	const loader = new GLTFLoader();
	const loaded = await Promise.allSettled(Object.entries(MODEL_URLS).map(async function ([kind, url]) {
		const gltf = await loader.loadAsync(url);
		try { return { kind, primitives: prepareModel(gltf.scene) }; }
		finally {
			gltf.scene.traverse(function (object) {
				if (!(object instanceof Mesh)) return;
				object.geometry.dispose();
				for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
			});
		}
	}));
	const assets = new Map<string, Primitive[]>();
	const errors: unknown[] = [];
	for (const result of loaded) {
		if (result.status === 'fulfilled') assets.set(result.value.kind, result.value.primitives);
		else errors.push(result.reason);
	}
	const disposeAssets = function (): void {
		for (const primitives of assets.values()) for (const primitive of primitives) {
			primitive.geometry.dispose(); primitive.material.dispose();
		}
		assets.clear();
	};
	if (errors.length > 0) { disposeAssets(); throw new AggregateError(errors, 'Fleet models could not load'); }
	const groups = new Map<FleetModelKind, { group: Group; capacity: number; meshes: InstancedMesh[]; primitives: Primitive[] | undefined }>();
	const pose = new Object3D();
	const color = new Color();
	const batch = function (kind: FleetModelKind, instances: readonly ModelInstance[], overview = false): Group {
		const primitives = assets.get(kind === 'ship' && overview ? 'shipOverview' : kind);
		if (!primitives) throw new Error(`Missing fleet model: ${kind}`);
		let entry = groups.get(kind);
		if (!entry) { entry = { group: new Group(), capacity: 0, meshes: [], primitives: undefined }; groups.set(kind, entry); }
		if (entry.capacity < instances.length || entry.primitives !== primitives) {
			for (const mesh of entry.meshes) { entry.group.remove(mesh); mesh.dispose(); }
			entry.capacity = Math.max(entry.capacity, 16, 2 ** Math.ceil(Math.log2(Math.max(1, instances.length))));
			entry.primitives = primitives;
			entry.meshes = primitives.map(function (primitive) {
				const mesh = new InstancedMesh(primitive.geometry, primitive.material, entry.capacity);
				mesh.instanceMatrix.setUsage(DynamicDrawUsage);
				// Visibility is checked per hull before batching; stale aggregate
				// bounds must never hide newly moved instances.
				mesh.frustumCulled = false;
				entry?.group.add(mesh);
				return mesh;
			});
		}
		for (const mesh of entry.meshes) mesh.count = instances.length;
		for (const [index, instance] of instances.entries()) {
			pose.position.set(instance.x, 0, instance.y);
			pose.rotation.set(0, -instance.heading, 0);
			pose.scale.setScalar(instance.length);
			pose.updateMatrix();
			for (const [part, mesh] of entry.meshes.entries()) {
				mesh.setMatrixAt(index, pose.matrix);
				if (primitives[part]?.accent) mesh.setColorAt(index, color.set(COLORS[instance.owner]));
			}
		}
		for (const mesh of entry.meshes) {
			mesh.instanceMatrix.needsUpdate = true;
			if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		}
		return entry.group;
	};
	return {
		batch,
		inspect: function (): FleetModelInspection { return { batches: groups.size, primitives: [...assets.values()].reduce(function (sum, parts) { return sum + parts.length; }, 0) }; },
		dispose: function (): void {
			for (const entry of groups.values()) {
				entry.group.removeFromParent();
				for (const mesh of entry.meshes) mesh.dispose();
			}
			groups.clear(); disposeAssets();
		},
	};
};
