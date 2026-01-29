import type { ColorFormat } from "./types";

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
	const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
	const expandedHex = hex.replace(
		shorthandRegex,
		(_, r, g, b) => r + r + g + g + b + b,
	);

	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expandedHex);
	return result
		? {
				r: Number.parseInt(result[1], 16),
				g: Number.parseInt(result[2], 16),
				b: Number.parseInt(result[3], 16),
			}
		: null;
}

function rgbToHex(r: number, g: number, b: number): string {
	return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function rgbToHsl(
	r: number,
	g: number,
	b: number,
): { h: number; s: number; l: number } {
	const rNorm = r / 255;
	const gNorm = g / 255;
	const bNorm = b / 255;

	const max = Math.max(rNorm, gNorm, bNorm);
	const min = Math.min(rNorm, gNorm, bNorm);
	let h = 0;
	let s = 0;
	const l = (max + min) / 2;

	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

		switch (max) {
			case rNorm:
				h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
				break;
			case gNorm:
				h = (bNorm - rNorm) / d + 2;
				break;
			case bNorm:
				h = (rNorm - gNorm) / d + 4;
				break;
		}

		h /= 6;
	}

	return { h: h * 360, s: s * 100, l: l * 100 };
}

function parseHsl(hslStr: string): { h: number; s: number; l: number } | null {
	const match = /hsl\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)/i.exec(hslStr) || 
	              /hsl\(\s*(\d+)\s+(\d+)%\s+(\d+)%\s*\)/i.exec(hslStr);

	if (!match) {
		const rawValues = hslStr.split(" ");
		if (rawValues.length === 3) {
			return {
				h: Number.parseFloat(rawValues[0]),
				s: Number.parseFloat(rawValues[1].replace("%", "")),
				l: Number.parseFloat(rawValues[2].replace("%", "")),
			};
		}
		return null;
	}

	return {
		h: Number.parseInt(match[1], 10),
		s: Number.parseInt(match[2], 10),
		l: Number.parseInt(match[3], 10),
	};
}

export function colorFormatter(
	color: string,
	targetFormat: ColorFormat,
	precision = "0",
): string {
	if (!color) return "";

	if ((targetFormat === "hex" && color.startsWith("#")) ||
	    (targetFormat === "hsl" && color.startsWith("hsl")) ||
	    (targetFormat === "rgb" && color.startsWith("rgb")) ||
	    (targetFormat === "oklch" && color.startsWith("oklch"))) {
		return color;
	}

	let r: number, g: number, b: number;

	if (color.startsWith("#")) {
		const rgb = hexToRgb(color);
		if (!rgb) return color;
		({ r, g, b } = rgb);
	} else if (color.startsWith("rgb")) {
		const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
		if (!match) return color;
		r = Number.parseInt(match[1], 10);
		g = Number.parseInt(match[2], 10);
		b = Number.parseInt(match[3], 10);
	} else if (color.startsWith("hsl") || color.includes(" ")) {
		const hsl = parseHsl(color);
		if (!hsl) return color;

		const { h, s, l } = hsl;
		const c = ((1 - Math.abs((2 * l) / 100 - 1)) * s) / 100;
		const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
		const m = l / 100 - c / 2;

		let rp: number, gp: number, bp: number;

		if (h < 60) {
			[rp, gp, bp] = [c, x, 0];
		} else if (h >= 60 && h < 120) {
			[rp, gp, bp] = [x, c, 0];
		} else if (h >= 120 && h < 180) {
			[rp, gp, bp] = [0, c, x];
		} else if (h >= 180 && h < 240) {
			[rp, gp, bp] = [0, x, c];
		} else if (h >= 240 && h < 300) {
			[rp, gp, bp] = [x, 0, c];
		} else {
			[rp, gp, bp] = [c, 0, x];
		}

		r = Math.round((rp + m) * 255);
		g = Math.round((gp + m) * 255);
		b = Math.round((bp + m) * 255);
	} else {
		return color;
	}
	switch (targetFormat) {
		case "hex":
			return rgbToHex(r, g, b);
		case "rgb":
			return `rgb(${r}, ${g}, ${b})`;
		case "hsl": {
			const { h, s, l } = rgbToHsl(r, g, b);
			const hRounded = Math.round(h);
			const sRounded = Math.round(s);
			const lRounded = Math.round(l);
			return precision === "0" 
				? `${hRounded} ${sRounded}% ${lRounded}%`
				: `hsl(${hRounded}, ${sRounded}%, ${lRounded}%)`;
		}
		case "oklch": {
			const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
			const C = Math.sqrt((r - g) ** 2 + (r - b) ** 2 + (g - b) ** 2) / 255 / 3;
			const H = (Math.atan2(b - g, r - g) * 180) / Math.PI;
			return `oklch(${L} ${C} ${H})`;
		}
		default:
			return color;
	}
}
