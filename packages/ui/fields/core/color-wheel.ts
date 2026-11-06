/**
 * color-wheel — the geometry of ColorPicker's wheel: hue is the angle (red at the top, clockwise),
 * saturation the distance from the centre, white at the middle and full colour at the rim.
 */

/** A point on the wheel, in `0`–`100` percentages of its box. */
export interface WheelPoint {
	x: number;
	y: number;
}

const RADIANS = Math.PI / 180;

/** The hue and saturation at an offset from the centre. A point past the rim lands on the rim. */
export function wheelToHueSaturation(
	dx: number,
	dy: number,
	radius: number,
): { h: number; s: number } {
	const distance = Math.hypot(dx, dy);
	if (distance === 0) return { h: 0, s: 0 };
	const h = (Math.round(Math.atan2(dx, -dy) / RADIANS) + 360) % 360;
	return { h, s: Math.min(100, Math.round((distance / radius) * 100)) };
}

/** Where a hue and saturation sit on the wheel: the inverse of {@link wheelToHueSaturation}. */
export function hueSaturationToWheel(h: number, s: number): WheelPoint {
	const reach = s / 2;
	return {
		x: 50 + Math.sin(h * RADIANS) * reach,
		y: 50 - Math.cos(h * RADIANS) * reach,
	};
}
