import type { JSX } from "preact";

/**
 * flag-art — circular-crop flag artwork for {@link import("../components/Flag.tsx").Flag}.
 *
 * Every flag is drawn on a 32 × 32 square that the component crops to a circle, so each design keeps
 * its identifying feature inside the inscribed circle: a centre emblem stays centred, a hoist emblem
 * moves inward. The colours are the flags' own and are content, not theme — the same footing as a
 * brand mark (`GoogleGlyph`) — so they never pass through the token layer and never shift with
 * dark mode or the contrast overlay.
 */

// #region Builders
type Art = () => JSX.Element;

const S = 32;

function bands(
	axis: "h" | "v",
	colors: readonly string[],
	weights?: readonly number[],
): JSX.Element {
	const w = weights ?? colors.map(() => 1);
	const total = w.reduce((a, b) => a + b, 0);
	let at = 0;
	return (
		<>
			{colors.map((fill, i) => {
				const size = (w[i] / total) * S;
				const rect = axis === "h"
					? <rect key={i} x="0" y={at} width={S} height={size + 0.01} fill={fill} />
					: <rect key={i} x={at} y="0" width={size + 0.01} height={S} fill={fill} />;
				at += size;
				return rect;
			})}
		</>
	);
}

function starPoints(cx: number, cy: number, r: number, points = 5, inner = 0.42): string {
	const out: string[] = [];
	for (let i = 0; i < points * 2; i++) {
		const radius = i % 2 === 0 ? r : r * inner;
		const angle = -Math.PI / 2 + (i * Math.PI) / points;
		out.push(
			`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`,
		);
	}
	return out.join(" ");
}

function star(
	cx: number,
	cy: number,
	r: number,
	fill: string,
	points = 5,
	inner = 0.42,
): JSX.Element {
	return <polygon points={starPoints(cx, cy, r, points, inner)} fill={fill} />;
}

function unionJack(scale = 1): JSX.Element {
	const s = S * scale;
	const c = s / 2;
	return (
		<>
			<rect x="0" y="0" width={s} height={s} fill="#012169" />
			<path d={`M0 0L${s} ${s}M${s} 0L0 ${s}`} stroke="#FFFFFF" stroke-width={6.4 * scale} />
			<path d={`M0 0L${s} ${s}M${s} 0L0 ${s}`} stroke="#C8102E" stroke-width={2.1 * scale} />
			<rect x={c - 4 * scale} y="0" width={8 * scale} height={s} fill="#FFFFFF" />
			<rect x="0" y={c - 4 * scale} width={s} height={8 * scale} fill="#FFFFFF" />
			<rect x={c - 2.4 * scale} y="0" width={4.8 * scale} height={s} fill="#C8102E" />
			<rect x="0" y={c - 2.4 * scale} width={s} height={4.8 * scale} fill="#C8102E" />
		</>
	);
}
// #endregion

// #region Artwork
const MAPLE_LEAF =
	"16,6 17.5,9 19.5,8.2 18.8,13 21.5,10.5 22,12 25,11.4 24,15 25.5,15.8 20.5,19.8 21,21.6 16.6,21 16.6,25 15.4,25 15.4,21 11,21.6 11.5,19.8 6.5,15.8 8,15 7,11.4 10,12 10.5,10.5 13.2,13 12.5,8.2 14.5,9";

const ART: Readonly<Record<string, Art>> = {
	GB: () => unionJack(),
	US: () => (
		<>
			{Array.from({ length: 13 }, (_, i) => (
				<rect
					key={i}
					x="0"
					y={(i * S) / 13}
					width={S}
					height={S / 13 + 0.01}
					fill={i % 2 === 0 ? "#B22234" : "#FFFFFF"}
				/>
			))}
			<rect x="0" y="0" width="15" height={(7 * S) / 13} fill="#3C3B6E" />
			{Array.from(
				{ length: 12 },
				(_, i) => (
					<circle
						key={i}
						cx={2.4 + (i % 4) * 3.4}
						cy={2.6 + Math.floor(i / 4) * 5.4}
						r="0.75"
						fill="#FFFFFF"
					/>
				),
			)}
		</>
	),
	EU: () => (
		<>
			<rect x="0" y="0" width={S} height={S} fill="#003399" />
			{Array.from({ length: 12 }, (_, i) => {
				const angle = (i * Math.PI) / 6;
				return (
					<polygon
						key={i}
						points={starPoints(16 + 9.5 * Math.sin(angle), 16 - 9.5 * Math.cos(angle), 1.7)}
						fill="#FFCC00"
					/>
				);
			})}
		</>
	),
	CA: () => (
		<>
			{bands("v", ["#D52B1E", "#FFFFFF", "#D52B1E"], [6, 20, 6])}
			<polygon points={MAPLE_LEAF} fill="#D52B1E" />
		</>
	),
	AU: () => (
		<>
			<rect x="0" y="0" width={S} height={S} fill="#012169" />
			<g>{unionJack(0.5)}</g>
			{star(8, 24, 3.4, "#FFFFFF", 7, 0.45)}
			{star(24, 7, 1.6, "#FFFFFF", 7, 0.45)}
			{star(19.5, 14, 1.6, "#FFFFFF", 7, 0.45)}
			{star(27.5, 13, 1.6, "#FFFFFF", 7, 0.45)}
			{star(24, 26, 1.8, "#FFFFFF", 7, 0.45)}
			{star(25.6, 18.6, 0.9, "#FFFFFF")}
		</>
	),
	JP: () => (
		<>
			<rect x="0" y="0" width={S} height={S} fill="#FFFFFF" />
			<circle cx="16" cy="16" r="9" fill="#BC002D" />
		</>
	),
	IN: () => (
		<>
			{bands("h", ["#FF9933", "#FFFFFF", "#138808"])}
			<circle cx="16" cy="16" r="3.6" fill="none" stroke="#000080" stroke-width="0.9" />
			<circle cx="16" cy="16" r="0.9" fill="#000080" />
			<path
				d="M16 12.4V19.6M12.4 16H19.6M13.45 13.45L18.55 18.55M18.55 13.45L13.45 18.55"
				stroke="#000080"
				stroke-width="0.45"
			/>
		</>
	),
	SG: () => (
		<>
			{bands("h", ["#EF3340", "#FFFFFF"])}
			<circle cx="10.5" cy="8.5" r="4.6" fill="#FFFFFF" />
			<circle cx="12.3" cy="8.5" r="4.3" fill="#EF3340" />
			{[0, 1, 2, 3, 4].map((i) => {
				const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
				return (
					<polygon
						key={i}
						points={starPoints(16.3 + 2.6 * Math.cos(angle), 8.8 + 2.6 * Math.sin(angle), 0.95)}
						fill="#FFFFFF"
					/>
				);
			})}
		</>
	),
	CH: () => (
		<>
			<rect x="0" y="0" width={S} height={S} fill="#DA291C" />
			<rect x="13" y="7" width="6" height="18" fill="#FFFFFF" />
			<rect x="7" y="13" width="18" height="6" fill="#FFFFFF" />
		</>
	),
	ZA: () => (
		<>
			{bands("h", ["#E03C31", "#001489"])}
			<path d="M-3 -4L13 16H35M-3 36L13 16" fill="none" stroke="#FFFFFF" stroke-width="10.4" />
			<path d="M-3 -4L13 16H35M-3 36L13 16" fill="none" stroke="#007749" stroke-width="6.4" />
			<polygon points="0,3.6 10.4,16 0,28.4" fill="#FFB81C" />
			<polygon points="0,6.4 8.1,16 0,25.6" fill="#000000" />
		</>
	),
	NG: () => bands("v", ["#008751", "#FFFFFF", "#008751"]),
	AE: () => (
		<>
			{bands("h", ["#00732F", "#FFFFFF", "#000000"])}
			<rect x="0" y="0" width="9" height={S} fill="#FF0000" />
		</>
	),
	IE: () => bands("v", ["#169B62", "#FFFFFF", "#FF883E"]),
	NZ: () => (
		<>
			<rect x="0" y="0" width={S} height={S} fill="#012169" />
			<g>{unionJack(0.5)}</g>
			{star(23.5, 7.5, 1.9, "#FFFFFF")}
			{star(23.5, 7.5, 1.3, "#C8102E")}
			{star(19.5, 15, 1.9, "#FFFFFF")}
			{star(19.5, 15, 1.3, "#C8102E")}
			{star(27, 13.5, 1.6, "#FFFFFF")}
			{star(27, 13.5, 1.05, "#C8102E")}
			{star(23.5, 25, 2.1, "#FFFFFF")}
			{star(23.5, 25, 1.45, "#C8102E")}
		</>
	),
	FR: () => bands("v", ["#0055A4", "#FFFFFF", "#EF4135"]),
	DE: () => bands("h", ["#000000", "#DD0000", "#FFCE00"]),
	ES: () => (
		<>
			{bands("h", ["#AA151B", "#F1BF00", "#AA151B"], [1, 2, 1])}
			<rect x="9.5" y="12" width="4.4" height="7.4" rx="1.2" fill="#AA151B" />
			<rect x="10.4" y="13" width="2.6" height="2.6" fill="#F1BF00" />
		</>
	),
	IT: () => bands("v", ["#009246", "#FFFFFF", "#CE2B37"]),
	NL: () => bands("h", ["#AE1C28", "#FFFFFF", "#21468B"]),
	PT: () => (
		<>
			{bands("v", ["#006600", "#FF0000"], [2, 3])}
			<circle cx="12.8" cy="16" r="5.2" fill="none" stroke="#FFE900" stroke-width="1.6" />
			<rect x="10.6" y="13.2" width="4.4" height="5.6" rx="1.4" fill="#FFFFFF" />
			<rect x="11.4" y="14" width="2.8" height="4" rx="0.9" fill="#FF0000" />
		</>
	),
	BR: () => (
		<>
			<rect x="0" y="0" width={S} height={S} fill="#009C3B" />
			<polygon points="16,4 30.5,16 16,28 1.5,16" fill="#FFDF00" />
			<circle cx="16" cy="16" r="6.6" fill="#002776" />
			<path
				d="M9.6 14.6C13.6 13.6 18.6 14.2 22.4 17.2"
				fill="none"
				stroke="#FFFFFF"
				stroke-width="1.2"
			/>
		</>
	),
	SA: () => (
		<>
			<rect x="0" y="0" width={S} height={S} fill="#165D31" />
			<path
				d="M7.5 13.5C9 11 10.5 15 12 12.5S15 15 16.5 12.5 19.5 15 21 12.5 23.5 14.5 24.5 12"
				fill="none"
				stroke="#FFFFFF"
				stroke-width="1.1"
				stroke-linecap="round"
			/>
			<rect x="8" y="19.6" width="15" height="1.3" rx="0.6" fill="#FFFFFF" />
			<rect x="21.6" y="18.4" width="1.2" height="3.7" rx="0.5" fill="#FFFFFF" />
		</>
	),
	IL: () => (
		<>
			<rect x="0" y="0" width={S} height={S} fill="#FFFFFF" />
			<rect x="0" y="4.5" width={S} height="3.4" fill="#0038B8" />
			<rect x="0" y="24.1" width={S} height="3.4" fill="#0038B8" />
			<polygon
				points="16,10.6 20.7,18.7 11.3,18.7"
				fill="none"
				stroke="#0038B8"
				stroke-width="1.2"
			/>
			<polygon
				points="16,21.4 11.3,13.3 20.7,13.3"
				fill="none"
				stroke="#0038B8"
				stroke-width="1.2"
			/>
		</>
	),
	CN: () => (
		<>
			<rect x="0" y="0" width={S} height={S} fill="#EE1C25" />
			{star(10.5, 11, 4.8, "#FFFF00")}
			{star(17, 5.6, 1.5, "#FFFF00")}
			{star(19.8, 8.8, 1.5, "#FFFF00")}
			{star(19.8, 13, 1.5, "#FFFF00")}
			{star(17, 16.2, 1.5, "#FFFF00")}
		</>
	),
	KR: () => (
		<>
			<rect x="0" y="0" width={S} height={S} fill="#FFFFFF" />
			<path d="M10 16A6 6 0 0 1 22 16A3 3 0 0 1 16 16A3 3 0 0 0 10 16Z" fill="#CD2E3A" />
			<path d="M22 16A6 6 0 0 1 10 16A3 3 0 0 1 16 16A3 3 0 0 0 22 16Z" fill="#0047A0" />
			<path
				d="M5.4 9.6L8.2 6.2M6.6 10.6L9.4 7.2M7.8 11.6L10.6 8.2M21.4 23.8L24.2 20.4M22.6 24.8L25.4 21.4M23.8 25.8L26.6 22.4M21.4 8.2L24.2 11.6M22.6 7.2L25.4 10.6M23.8 6.2L26.6 9.6M5.4 22.4L8.2 25.8M6.6 21.4L9.4 24.8M7.8 20.4L10.6 23.8"
				stroke="#000000"
				stroke-width="0.8"
			/>
		</>
	),
	MX: () => (
		<>
			{bands("v", ["#006847", "#FFFFFF", "#CE1126"])}
			<circle cx="16" cy="16" r="2.8" fill="#8C5A2B" />
			<path d="M13 18.6Q16 20.6 19 18.6" fill="none" stroke="#006847" stroke-width="0.9" />
		</>
	),
	PL: () => bands("h", ["#FFFFFF", "#DC143C"]),
	SE: () => (
		<>
			<rect x="0" y="0" width={S} height={S} fill="#006AA7" />
			<rect x="10" y="0" width="5" height={S} fill="#FECC00" />
			<rect x="0" y="13.5" width={S} height="5" fill="#FECC00" />
		</>
	),
	TR: () => (
		<>
			<rect x="0" y="0" width={S} height={S} fill="#E30A17" />
			<circle cx="13.5" cy="16" r="6.4" fill="#FFFFFF" />
			<circle cx="15.1" cy="16" r="5.1" fill="#E30A17" />
			{star(20.4, 16, 2.6, "#FFFFFF")}
		</>
	),
	PK: () => (
		<>
			<rect x="0" y="0" width={S} height={S} fill="#01411C" />
			<rect x="0" y="0" width="8" height={S} fill="#FFFFFF" />
			<circle cx="19.5" cy="16" r="6.2" fill="#FFFFFF" />
			<circle cx="21.4" cy="14.6" r="5.4" fill="#01411C" />
			{star(23.2, 12.4, 2, "#FFFFFF")}
		</>
	),
};
// #endregion

/** Whether artwork exists for a code (ISO 3166-1 alpha-2, or `EU`). */
export function hasFlagArt(code: string): boolean {
	return Object.hasOwn(ART, code.toUpperCase());
}

/** The artwork for a code, or `null` when none is drawn (the caller renders its fallback). */
export function flagArt(code: string): JSX.Element | null {
	const art = ART[code.toUpperCase()];
	return art ? art() : null;
}

/** Every code that has artwork, sorted. */
export const FLAG_CODES: readonly string[] = Object.keys(ART).sort();
