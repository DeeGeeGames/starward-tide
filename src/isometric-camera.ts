import { OrthographicCamera } from 'three';
import type { Camera } from './camera';
import { unprojectMap } from './isometric';

export const syncIsometricCamera = function (view: OrthographicCamera, camera: Camera, width: number, height: number): void {
	const center = unprojectMap({ x: (width / 2 - camera.x) / camera.scale, y: (height / 2 - camera.y) / camera.scale });
	view.left = -width / (2 * camera.scale);
	view.right = -view.left;
	view.top = height / (2 * camera.scale);
	view.bottom = -view.top;
	view.position.set(center.x + 10000, 10000, center.y + 10000);
	view.lookAt(center.x, 0, center.y);
	view.updateProjectionMatrix();
	view.updateMatrixWorld();
};
