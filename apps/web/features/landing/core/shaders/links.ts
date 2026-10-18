/**
 * links.ts — the lines that join a gathered team: one instanced quad per segment, a hairline with an
 * anti-aliased edge, premultiplied for the same `MAX` blend as the nodes.
 */
import { CLIP_CHUNK, ZONE_CHUNK } from "./zones.ts";
import { float, glsl } from "./glsl.ts";

/** Half the drawn line width, edge feather included (CSS px). */
export const LINK_HALF_WIDTH = 1;

/** Attribute locations: the shared quad (`t` along, side across), then `x1, y1, x2, y2` and alpha. */
export const LINK_ATTRIBUTES = { corner: 0, segment: 1, alpha: 2 } as const;

/** Vertex shader. */
export const LINK_VERTEX = glsl`#version 300 es
precision highp float;
${CLIP_CHUNK}
layout(location = ${LINK_ATTRIBUTES.corner}) in vec2 a_corner;
layout(location = ${LINK_ATTRIBUTES.segment}) in vec4 a_segment;
layout(location = ${LINK_ATTRIBUTES.alpha}) in float a_alpha;

out vec2 v_px;
out float v_side;
out float v_alpha;

void main() {
	vec2 from = a_segment.xy;
	vec2 to = a_segment.zw;
	vec2 span = to - from;
	float len = length(span);
	vec2 dir = len > 0.001 ? span / len : vec2(1.0, 0.0);
	vec2 normal = vec2(-dir.y, dir.x);
	vec2 px = mix(from, to, a_corner.x) + normal * a_corner.y * ${float(LINK_HALF_WIDTH)};
	v_px = px;
	v_side = a_corner.y;
	v_alpha = a_alpha;
	gl_Position = toClip(px);
}
`;

/** Fragment shader. */
export const LINK_FRAGMENT = glsl`#version 300 es
precision highp float;
${ZONE_CHUNK}
uniform vec3 u_color;

in vec2 v_px;
in float v_side;
in float v_alpha;

out vec4 o_color;

const float LINK_STRENGTH = 0.75;

void main() {
	float edge = 1.0 - smoothstep(0.45, 1.0, abs(v_side));
	float a = edge * v_alpha * LINK_STRENGTH * zoneCap(v_px);
	if (a <= 0.002) discard;
	o_color = vec4(u_color * a, a);
}
`;
