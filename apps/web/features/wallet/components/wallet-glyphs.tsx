import type { JSX } from "preact";

/**
 * wallet-glyphs — the minimal, token-driven stroke icon set for the Wallet surface (lane sub-nav ·
 * action modals · fund-state chips). Icon-first density (§B.6): every glyph is a `currentColor` stroke
 * SVG sized by a `size` prop, matching the projects/catalogue/messaging glyph style (stroke-width 1.8).
 * These are VNode-returning components — reference as `{WalletIcon}` / `<WalletIcon .../>`, never mounted
 * twice at once without `cloneElement`.
 */

interface IconProps {
	size?: number;
	class?: string;
}

/** The stroke-svg wrapper shared by every glyph. */
function Svg(
	{ size = 20, class: cls, children }: IconProps & { children: JSX.Element | JSX.Element[] },
): JSX.Element {
	return (
		<svg
			class={cls}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width={1.8}
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

/** The name-keyed icon (drives the lane sub-nav + footer rig + action buttons from a string key). */
export function WalletIcon(
	{ name, size, class: cls }: { name: string; size?: number; class?: string },
): JSX.Element {
	switch (name) {
		case "wallet":
			return (
				<Svg size={size} class={cls}>
					<path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1" />
					<path d="M3 7v10a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-3" />
					<path d="M21 11h-4a2 2 0 0 0 0 4h4a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1Z" />
				</Svg>
			);
		case "overview":
			return (
				<Svg size={size} class={cls}>
					<rect x="3" y="3" width="8" height="8" rx="1.5" />
					<rect x="13" y="3" width="8" height="5" rx="1.5" />
					<rect x="13" y="11" width="8" height="10" rx="1.5" />
					<rect x="3" y="14" width="8" height="7" rx="1.5" />
				</Svg>
			);
		case "ledger":
			return (
				<Svg size={size} class={cls}>
					<path d="M5 4h14v16H5z" />
					<path d="M9 8h6M9 12h6M9 16h4" />
				</Svg>
			);
		case "activity":
			return (
				<Svg size={size} class={cls}>
					<path d="M3 17l5-6 4 4 4-8 5 7" />
				</Svg>
			);
		case "payout":
			return (
				<Svg size={size} class={cls}>
					<path d="M12 3v12" />
					<path d="M8 11l4 4 4-4" />
					<path d="M4 19h16" />
				</Svg>
			);
		case "funding":
			return (
				<Svg size={size} class={cls}>
					<path d="M12 21V9" />
					<path d="M8 13l4-4 4 4" />
					<path d="M4 5h16" />
				</Svg>
			);
		case "card":
			return (
				<Svg size={size} class={cls}>
					<rect x="3" y="6" width="18" height="12" rx="2" />
					<path d="M3 10h18M7 15h3" />
				</Svg>
			);
		case "invoice":
			return (
				<Svg size={size} class={cls}>
					<path d="M6 3h9l3 3v15l-2-1-2 1-2-1-2 1-2-1-2 1V3Z" />
					<path d="M9 8h6M9 12h6M9 16h3" />
				</Svg>
			);
		case "access":
			return (
				<Svg size={size} class={cls}>
					<path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6l7-3Z" />
					<path d="M9 12l2 2 4-4" />
				</Svg>
			);
		case "topup":
			return (
				<Svg size={size} class={cls}>
					<circle cx="12" cy="12" r="8.5" />
					<path d="M12 8v8M8 12h8" />
				</Svg>
			);
		case "withdraw":
			return (
				<Svg size={size} class={cls}>
					<circle cx="12" cy="12" r="8.5" />
					<path d="M8 12h8" />
				</Svg>
			);
		case "transfer":
			return (
				<Svg size={size} class={cls}>
					<path d="M4 8h13l-3-3M20 16H7l3 3" />
				</Svg>
			);
		case "distribute":
			return (
				<Svg size={size} class={cls}>
					<circle cx="12" cy="5" r="2.4" />
					<circle cx="5" cy="18" r="2.4" />
					<circle cx="19" cy="18" r="2.4" />
					<path d="M12 7.4v4M11 12l-4.5 4M13 12l4.5 4" />
				</Svg>
			);
		case "escrow":
			return (
				<Svg size={size} class={cls}>
					<rect x="5" y="10" width="14" height="10" rx="2" />
					<path d="M8 10V7a4 4 0 0 1 8 0v3" />
				</Svg>
			);
		case "recurring":
			return (
				<Svg size={size} class={cls}>
					<path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2" />
					<path d="M20 4v5h-5M4 20v-5h5" />
				</Svg>
			);
		case "request":
			return (
				<Svg size={size} class={cls}>
					<path d="M12 3v18M5 10l7-7 7 7" />
				</Svg>
			);
		case "smoother":
			return (
				<Svg size={size} class={cls}>
					<path d="M3 15c3 0 3-6 6-6s3 6 6 6 3-6 6-6" />
				</Svg>
			);
		default:
			return (
				<Svg size={size} class={cls}>
					<circle cx="12" cy="12" r="8" />
				</Svg>
			);
	}
}

/** The wallet brand mark (lane header + rail top). */
export function WalletBrand({ size = 22, class: cls }: IconProps): JSX.Element {
	return <WalletIcon name="wallet" size={size} class={cls} />;
}

/** A plus glyph (add actions). */
export function PlusIcon({ size = 18, class: cls }: IconProps): JSX.Element {
	return (
		<Svg size={size} class={cls}>
			<path d="M12 5v14M5 12h14" />
		</Svg>
	);
}

/** A right chevron (disclosures / links). */
export function ChevronIcon({ size = 16, class: cls }: IconProps): JSX.Element {
	return (
		<Svg size={size} class={cls}>
			<path d="M9 6l6 6-6 6" />
		</Svg>
	);
}

/** A small info glyph (origin-currency / disclosure hints). */
export function InfoIcon({ size = 15, class: cls }: IconProps): JSX.Element {
	return (
		<Svg size={size} class={cls}>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 11v5M12 8h.01" />
		</Svg>
	);
}

/** A downloadable / export glyph. */
export function ExportIcon({ size = 16, class: cls }: IconProps): JSX.Element {
	return (
		<Svg size={size} class={cls}>
			<path d="M12 3v11M8 10l4 4 4-4" />
			<path d="M5 19h14" />
		</Svg>
	);
}
