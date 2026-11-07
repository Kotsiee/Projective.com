/**
 * svg-allowlist — what an SVG may contain. Anything not named here is treated as active, because a
 * list of what is dangerous is only as complete as the last attack someone thought of.
 *
 * Left out on purpose: `script`; `foreignObject` (HTML inside an image); `set` (SMIL can write an
 * attribute, `href` included); SVG fonts, which fetch; and anything that embeds a document.
 */

const words = (list: string): ReadonlySet<string> => new Set(list.split(/\s+/).filter(Boolean));

/** Elements of the SVG namespace, by local name. XML is case-sensitive, so these are exact. */
export const SVG_ELEMENTS = words(`
	a animate animateMotion animateTransform circle clipPath defs desc ellipse
	feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting
	feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR
	feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight
	feSpecularLighting feSpotLight feTile feTurbulence
	filter g image line linearGradient marker mask metadata mpath path pattern polygon polyline
	radialGradient rect stop style svg switch symbol text textPath title tspan use view
`);

/** Attributes in no namespace. `style`, `href` and URL values are checked by their own rules. */
export const SVG_ATTRIBUTES = words(`
	accent-height accumulate additive alignment-baseline alphabetic amplitude arabic-form ascent
	attributeName attributeType azimuth baseFrequency baseProfile baseline-shift begin bias by
	calcMode cap-height class clip clip-path clip-rule clipPathUnits color color-interpolation
	color-interpolation-filters color-rendering cursor cx cy d descent diffuseConstant direction
	display divisor dominant-baseline dur dx dy edgeMode elevation enable-background end exponent
	fill fill-opacity fill-rule filter filterRes filterUnits flood-color flood-opacity font-family
	font-size font-size-adjust font-stretch font-style font-variant font-weight fr from fx fy g1 g2
	glyph-name glyph-orientation-horizontal glyph-orientation-vertical gradientTransform
	gradientUnits hanging height horiz-adv-x horiz-origin-x horiz-origin-y href id ideographic
	image-rendering in in2 intercept isolation k k1 k2 k3 k4 kernelMatrix kernelUnitLength kerning
	keyPoints keySplines keyTimes lang lengthAdjust letter-spacing lighting-color limitingConeAngle
	local marker-end marker-mid marker-start markerHeight markerUnits markerWidth mask mask-type
	maskContentUnits maskUnits mathematical max media method min mix-blend-mode mode name
	numOctaves offset opacity operator order orient orientation origin overflow overline-position
	overline-thickness paint-order panose-1 path pathLength patternContentUnits patternTransform
	patternUnits pointer-events points pointsAtX pointsAtY pointsAtZ preserveAlpha
	preserveAspectRatio primitiveUnits r radius refX refY rel rendering-intent repeatCount repeatDur
	requiredExtensions requiredFeatures restart result role rotate rx ry scale seed shape-rendering
	slope spacing specularConstant specularExponent spreadMethod startOffset stdDeviation stemh
	stemv stitchTiles stop-color stop-opacity strikethrough-position strikethrough-thickness string
	stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit
	stroke-opacity stroke-width style surfaceScale systemLanguage tabindex tableValues target
	targetX targetY text-anchor text-decoration text-orientation text-rendering textLength
	title to transform transform-box transform-origin type u1 u2 underline-position
	underline-thickness unicode unicode-bidi unicode-range units-per-em v-alphabetic v-hanging
	v-ideographic v-mathematical values vector-effect version vert-adv-y vert-origin-x vert-origin-y
	viewBox viewTarget visibility width widths word-spacing wrap writing-mode x x-height x1 x2
	xChannelSelector y y1 y2 yChannelSelector z zoomAndPan
`);

/** Editors' private namespaces. Nothing renders them, so a clean file keeps them untouched. */
export const INERT_NAMESPACES = new Set([
	"http://www.inkscape.org/namespaces/inkscape",
	"http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd",
	"http://www.w3.org/1999/02/22-rdf-syntax-ns#",
	"http://purl.org/dc/elements/1.1/",
	"http://purl.org/dc/terms/",
	"http://creativecommons.org/ns#",
	"http://web.resource.org/cc/",
	"http://ns.adobe.com/AdobeIllustrator/10.0/",
	"http://ns.adobe.com/AdobeSVGViewerExtensions/3.0/",
	"http://ns.adobe.com/Extensibility/1.0/",
	"http://ns.adobe.com/Flows/1.0/",
	"http://ns.adobe.com/GenericCustomNamespace/1.0/",
	"http://ns.adobe.com/Graphs/1.0/",
	"http://ns.adobe.com/ImageReplacement/1.0/",
	"http://ns.adobe.com/SaveForWeb/1.0/",
	"http://ns.adobe.com/Variables/1.0/",
	"http://ns.adobe.com/xap/1.0/",
	"http://www.bohemiancoding.com/sketch/ns",
	"http://www.figma.com/figma/ns",
]);
