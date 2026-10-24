// Shared by the tactical holding and setup preview. The bow faces +X, matching
// carrier.heading; currentColor follows ownership without rebuilding the SVG.
export const createCarrierArtwork = function (): SVGSVGElement {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 100 100');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	svg.innerHTML = `
		<g stroke-linejoin="round">
			<path d="M12 35 22 35 27 22 65 22 78 32 82 40 94 47 94 53 82 60 78 68 65 78 27 78 22 65 12 65Z" fill="#101f2d" stroke="currentColor" stroke-width="2"/>
			<path d="M27 24H64L75 33 72 39H24ZM24 61H72L75 67 64 76H27Z" fill="currentColor" fill-opacity=".65"/>
			<path d="M25 41H77L90 48V52L77 59H25Z" fill="currentColor" fill-opacity=".2"/>
			<path d="M31 29H61L67 33H30ZM30 67H67L61 71H31Z" fill="#09131f"/>
			<path d="M36 29V33M44 29V33M52 29V33M36 67V71M44 67V71M52 67V71" stroke="currentColor" stroke-width="1.5"/>
			<path d="M21 42H29V58H21Z" fill="#09131f" stroke="currentColor" stroke-width="1"/>
			<path d="M70 44H78L83 48V52L78 56H70Z" fill="#09131f"/>
			<path d="M75 46 79 48V52L75 54" fill="none" stroke="#d9edf2" stroke-width="1.5"/>
			<path d="M12 37H18V45H12ZM12 47H18V53H12ZM12 55H18V63H12Z" fill="#09131f"/>
			<path d="M12 39V43M12 49V51M12 57V61" stroke="currentColor" stroke-width="3"/>
			<path d="M30 24H60M30 76H60" stroke="#d9edf2" stroke-opacity=".7" stroke-width="1"/>
		</g>`;
	return svg;
};
