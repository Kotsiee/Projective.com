/**
 * zones.ts — the quiet-zone ceiling every constellation fragment passes through.
 *
 * The hero's copy and its search halo are boxes in the background's CSS px (`constellation.ts`
 * `buildZones`). Inside a box a fragment's alpha is capped at that box's ceiling (copy: the quiet
 * alpha after the luminance clamp; halo: zero); a feather outside the box eases from the open-field
 * ceiling down to it, so the cap is exact wherever text can sit and no edge shows.
 */
import { MAX_ZONES } from "../constellation.ts";
import { glsl } from "./glsl.ts";

/** Uniforms and `float zoneCap(vec2 px)`, spliced after `#version` and `precision`. */
export const ZONE_CHUNK = glsl`
#define MAX_ZONES ${MAX_ZONES}
uniform float u_cap;
uniform vec4 u_zones[MAX_ZONES];
uniform float u_zoneCap[MAX_ZONES];
uniform int u_zoneCount;
uniform float u_feather;

float zoneCap(vec2 px) {
	float cap = u_cap;
	for (int i = 0; i < MAX_ZONES; i++) {
		if (i >= u_zoneCount) break;
		vec4 zone = u_zones[i];
		vec2 outside = max(max(zone.xy - px, px - zone.zw), vec2(0.0));
		float inside = 1.0 - smoothstep(0.0, u_feather, length(outside));
		cap = min(cap, mix(u_cap, u_zoneCap[i], inside));
	}
	return cap;
}
`;

/** CSS px → clip space for a box of `u_resolution` CSS px, y down. */
export const CLIP_CHUNK = glsl`
uniform vec2 u_resolution;

vec4 toClip(vec2 px) {
	vec2 unit = px / u_resolution * 2.0 - 1.0;
	return vec4(unit.x, -unit.y, 0.0, 1.0);
}
`;
