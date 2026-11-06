import { AdditiveBlending, BackSide, Color, ShaderMaterial } from 'three';

// Shared shells follow their planet mesh, so atmosphere cannot drift from the
// projection used by DOM labels or map picking. Orthographic views have a fixed
// view direction; a Fresnel rim supplies depth without extra lighting passes.
export const createAtmosphereMaterial = function (tint: string): ShaderMaterial {
	return new ShaderMaterial({
		uniforms: { tint: { value: new Color(tint) } },
		vertexShader: `
			varying vec3 viewNormal;
			void main() {
				viewNormal = normalize(normalMatrix * normal);
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
			uniform vec3 tint;
			varying vec3 viewNormal;
			void main() {
				float rim = pow(1.0 - abs(normalize(viewNormal).z), 2.4);
				gl_FragColor = vec4(tint, rim * 0.46);
				#include <colorspace_fragment>
			}
		`,
		side: BackSide,
		transparent: true,
		depthWrite: false,
		blending: AdditiveBlending,
	});
};
