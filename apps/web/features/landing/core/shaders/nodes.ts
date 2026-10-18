/**
 * nodes.ts — the constellation's nodes: one instanced quad per node, a crisp core and, when the node
 * has gathered, a soft glow. Output is premultiplied for a `MAX` blend, so overlapping glows never
 * add up past the brightest one and the zone ceilings hold per pixel.
 */
import { CLIP_CHUNK, ZONE_CHUNK } from "./zones.ts";
import { float, glsl } from "./glsl.ts";

/** How far a node's quad reaches, in core radii (room for the glow's tail). */
export const NODE_SPREAD = 4;

/** Attribute locations: the shared unit quad, then the per-instance `x, y, radius, alpha` and glow. */
export const NODE_ATTRIBUTES = { corner: 0, node: 1, lit: 2 } as const;

/** Vertex shader. */
export const NODE_VERTEX = glsl`#version 300 es
precision highp float;
${CLIP_CHUNK}
layout(location = ${NODE_ATTRIBUTES.corner}) in vec2 a_corner;
layout(location = ${NODE_ATTRIBUTES.node}) in vec4 a_node;
layout(location = ${NODE_ATTRIBUTES.lit}) in float a_lit;

out vec2 v_unit;
out vec2 v_px;
out float v_alpha;
out float v_lit;

void main() {
	float extent = a_node.z * ${float(NODE_SPREAD)};
	vec2 px = a_node.xy + a_corner * extent;
	v_unit = a_corner * ${float(NODE_SPREAD)};
	v_px = px;
	v_alpha = a_node.w;
	v_lit = a_lit;
	gl_Position = toClip(px);
}
`;

/** Fragment shader. */
export const NODE_FRAGMENT = glsl`#version 300 es
precision highp float;
${ZONE_CHUNK}
uniform vec3 u_color;

in vec2 v_unit;
in vec2 v_px;
in float v_alpha;
in float v_lit;

out vec4 o_color;

void main() {
	float d = length(v_unit);
	float core = 1.0 - smoothstep(0.75, 1.15, d);
	float glow = v_lit * 0.55 * exp(-d * d * 0.32);
	float a = max(core, glow) * v_alpha * zoneCap(v_px);
	if (a <= 0.002) discard;
	o_color = vec4(u_color * a, a);
}
`;
