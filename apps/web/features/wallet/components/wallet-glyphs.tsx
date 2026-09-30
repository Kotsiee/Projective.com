import type { JSX } from "preact";
import { Icon, type IconName, IconShell, type IconSize } from "@projective/ui/icons";
import type { FundState, TxnCategory, WalletAction } from "../types/wallet-types.ts";
import type { UpcomingKind } from "../core/wallet-home.ts";

/** The wallet's own domain glyphs — the vocabulary the shared registry does not own. */
export type WalletGlyphName = "escrow" | "earning" | "fee" | "refund" | "split" | "smooth" | "card";

const PATHS: Readonly<Record<WalletGlyphName, () => JSX.Element>> = {
	escrow: () => (
		<>
			<rect x="3.5" y="6" width="17" height="13" rx="2.2" />
			<path d="M3.5 10.5h17M10 14.5h4" />
		</>
	),
	earning: () => (
		<>
			<circle cx="9.5" cy="12" r="5.5" />
			<path d="M14.8 7.3a5.5 5.5 0 1 1 0 9.4" />
		</>
	),
	fee: () => (
		<>
			<circle cx="7.5" cy="7.5" r="2.2" />
			<circle cx="16.5" cy="16.5" r="2.2" />
			<path d="M18 6L6 18" />
		</>
	),
	refund: () => <path d="M9 13.5L4.5 9 9 4.5M4.5 9H14a5.5 5.5 0 0 1 0 11h-3" />,
	split: () => <path d="M12 20.5V13M12 13L6.5 7.5M12 13l5.5-5.5M6.5 12V7.5H11M17.5 12V7.5H13" />,
	smooth: () => <path d="M3.5 15c3.2 0 3.2-6 6.4-6s3.2 6 6.4 6c2 0 3.2-1.4 4.2-2.6" />,
	card: () => (
		<>
			<rect x="3" y="6" width="18" height="12.5" rx="2.4" />
			<path d="M3 10.5h18M7 15h3.5" />
		</>
	),
};

/** Renders a wallet domain glyph through the shared icon contract. */
export function WalletGlyph(
	{ name, size, class: cls }: { name: WalletGlyphName; size?: IconSize; class?: string },
): JSX.Element {
	return <IconShell size={size} class={cls}>{PATHS[name]()}</IconShell>;
}

type GlyphRef = { registry: IconName } | { wallet: WalletGlyphName };

const ACTION_GLYPH: Readonly<Record<WalletAction, GlyphRef>> = {
	top_up: { registry: "plus" },
	transfer: { registry: "arrow-up-right" },
	withdraw: { registry: "arrow-down-left" },
	distribute: { wallet: "split" },
	fund_escrow: { wallet: "escrow" },
	new_recurring: { registry: "repeat" },
	add_method: { wallet: "card" },
	set_payout: { registry: "history" },
	request_spend: { registry: "hourglass" },
	enrol_smoother: { wallet: "smooth" },
};

const CATEGORY_GLYPH: Readonly<Record<TxnCategory, GlyphRef>> = {
	earning: { wallet: "earning" },
	payout: { registry: "arrow-down-left" },
	deposit: { registry: "plus" },
	withdrawal: { registry: "arrow-down-left" },
	fee: { wallet: "fee" },
	refund: { wallet: "refund" },
	escrow: { wallet: "escrow" },
	transfer: { registry: "arrow-up-right" },
	spend: { registry: "basket" },
};

const UPCOMING_GLYPH: Readonly<Record<UpcomingKind, GlyphRef>> = {
	verify: { registry: "shield" },
	approval: { registry: "hourglass" },
	bill: { registry: "document" },
	fundable: { wallet: "escrow" },
	release: { registry: "clock" },
	escrow: { wallet: "escrow" },
	recurring: { registry: "repeat" },
	payout: { registry: "arrow-down-left" },
	smoother: { wallet: "smooth" },
};

const FUND_STATE_GLYPH: Readonly<Record<Exclude<FundState, "available">, GlyphRef>> = {
	locked: { wallet: "escrow" },
	pending: { registry: "clock" },
	on_hold: { registry: "pause" },
};

function render(ref: GlyphRef, size?: IconSize, cls?: string): JSX.Element {
	return "registry" in ref
		? <Icon name={ref.registry} size={size} class={cls} />
		: <WalletGlyph name={ref.wallet} size={size} class={cls} />;
}

/** The glyph an action wears on its pill, menu item and dialog. */
export function ActionIcon(
	{ action, size, class: cls }: { action: WalletAction; size?: IconSize; class?: string },
): JSX.Element {
	return render(ACTION_GLYPH[action], size, cls);
}

/** The glyph a ledger line wears for its category. */
export function CategoryIcon(
	{ category, size, class: cls }: { category: TxnCategory; size?: IconSize; class?: string },
): JSX.Element {
	return render(CATEGORY_GLYPH[category], size, cls);
}

/** The glyph an upcoming obligation wears. */
export function UpcomingIcon(
	{ kind, size, class: cls }: { kind: UpcomingKind; size?: IconSize; class?: string },
): JSX.Element {
	return render(UPCOMING_GLYPH[kind], size, cls);
}

/** The shape mark for a fund state other than available. */
export function FundStateIcon(
	{ state, size, class: cls }: {
		state: Exclude<FundState, "available">;
		size?: IconSize;
		class?: string;
	},
): JSX.Element {
	return render(FUND_STATE_GLYPH[state], size, cls);
}
