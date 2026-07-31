import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/wallet-card.css";
import { Backdrop, BodyPortal, usePresence } from "@projective/ui/overlay";
import { Tooltip } from "@projective/ui/feedback";
import { useDismiss, useFocusTrap, useId, useOverlayStack } from "@projective/ui/hooks";
import { styleVars } from "@ui/core/style.ts";
import { cx } from "@ui/core/cx.ts";
import { ExpandGlyph } from "../core/glyphs.tsx";
import { PaymentCard } from "../components/PaymentCard.tsx";
import { EmptyBand } from "../components/band-parts.tsx";
import { activeMethodId, deckExpanded } from "../core/wallet-state.ts";
import type { PaymentMethodView } from "../types/wallet-types.ts";

/**
 * CardDeck — the hero band's right third: the viewer's saved payment methods as a fanned physical
 * stack that widens on hover or focus and opens into a grid overlay on demand.
 *
 * **The deck has exactly one control of its own**, `.wlt-deck__expand`: an icon-only
 * `aria-expanded` disclosure. There is no "Manage methods" button and no text CTA — a primary call
 * to action inside a band body is the pattern this surface is built to refuse (§12.2). Managing a
 * method happens by opening the instrument itself.
 *
 * **The overlay mounts through {@link BodyPortal}.** The middle-nav lane is a glass,
 * `overflow: clip` stacking context, so a `position: fixed` layer that stays in the tree is re-based
 * onto the lane's box instead of the viewport — the documented fixed-overlay trap (RULE O-1). The
 * portal also guarantees expanding never reflows the height-locked hero band.
 *
 * **The fan mirrors.** Every offset multiplies `--wlt-fan-dir`, which `[dir="rtl"]` flips, so the
 * stack fans away from the reading edge in both directions — no raw horizontal translation exists in
 * the stylesheet. Arrow keys are mapped the same way: `ArrowRight` walks toward the end of the list
 * in LTR and toward its start in RTL, read from the live computed direction rather than assumed.
 *
 * Under reduced motion the fan does not animate at all: hover changes elevation only, the gloss is
 * removed, and the grid arrives with opacity alone (RULE M-1).
 */

// #region Props
/** Props for {@link CardDeck}. */
export interface CardDeckProps {
	/** The viewer's saved methods, in server order. The first three fan; the overlay shows them all. */
	methods: PaymentMethodView[];
	/**
	 * Whether the viewer may manage these instruments. When false the deck stays legible but inert:
	 * the cards render as static faces rather than buttons, because opening one leads only to
	 * management.
	 */
	canManage: boolean;
}
// #endregion

/** How many instruments the resting fan shows before the count line takes over (§10). */
const FAN_LIMIT = 3;

/**
 * The disclosure's collapse mark — arrows drawn inward, the inverse of the shared `ExpandGlyph`.
 * Returned from a function so the resting and expanded triggers never share one VNode instance.
 */
function collapseMark(): JSX.Element {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d="M9.6 4v4.2a1.4 1.4 0 0 1-1.4 1.4H4" />
			<path d="M14.4 4v4.2a1.4 1.4 0 0 0 1.4 1.4H20" />
			<path d="M14.4 20v-4.2a1.4 1.4 0 0 1 1.4-1.4H20" />
			<path d="M9.6 20v-4.2a1.4 1.4 0 0 0-1.4-1.4H4" />
		</svg>
	);
}

/** Whether an element resolves to a right-to-left writing direction at this moment. */
function isRtl(el: HTMLElement | null): boolean {
	if (!el || typeof globalThis.getComputedStyle !== "function") return false;
	return globalThis.getComputedStyle(el).direction === "rtl";
}

export default function CardDeck(props: CardDeckProps): JSX.Element {
	const { methods, canManage } = props;

	// #region State
	/** The roving-tabindex slot, so a fanned stack costs one Tab stop rather than one per card. */
	const roving = useSignal(0);
	const restListRef = useRef<HTMLUListElement>(null);
	const gridListRef = useRef<HTMLUListElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const countId = useId(undefined, "wlt-deck-count");

	const open = deckExpanded.value;
	const presence = usePresence(open, 220);
	const stack = useOverlayStack({ active: presence.mounted, lockScroll: true, layer: "modal" });

	const collapse = () => {
		deckExpanded.value = false;
		triggerRef.current?.focus();
	};

	useFocusTrap({ active: presence.mounted, containerRef: panelRef });
	useDismiss({ open: presence.mounted, onDismiss: collapse, panelRef, triggerRef });
	// #endregion

	// #region Keyboard
	/**
	 * Walk the roving slot. Inline arrows follow the writing direction so the key that moves toward
	 * the visually next card is the same key in both directions; block arrows are direction-neutral
	 * and always walk the list order.
	 */
	const onListKeyDown = (
		list: typeof restListRef,
		count: number,
	) =>
	(event: JSX.TargetedKeyboardEvent<HTMLUListElement>) => {
		if (count === 0) return;
		if (event.key === "Escape") {
			event.preventDefault();
			if (open) collapse();
			else triggerRef.current?.focus();
			return;
		}

		const rtl = isRtl(list.current);
		let next: number;
		switch (event.key) {
			case "ArrowRight":
				next = roving.value + (rtl ? -1 : 1);
				break;
			case "ArrowLeft":
				next = roving.value + (rtl ? 1 : -1);
				break;
			case "ArrowDown":
				next = roving.value + 1;
				break;
			case "ArrowUp":
				next = roving.value - 1;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = count - 1;
				break;
			default:
				return;
		}
		event.preventDefault();
		const clamped = Math.max(0, Math.min(count - 1, next));
		roving.value = clamped;
		list.current?.querySelectorAll<HTMLButtonElement>(".wlt-card")[clamped]?.focus();
	};
	// #endregion

	// #region Rendering
	const openMethod = (id: string) => {
		activeMethodId.value = id;
		if (deckExpanded.value) deckExpanded.value = false;
	};

	/** One list item: the fan geometry lives on the item, the lift on the card inside it. */
	const item = (method: PaymentMethodView, i: number, size: "deck" | "grid") => (
		<li key={method.id} style={styleVars({ "--wlt-i": i })}>
			<PaymentCard
				method={method}
				size={size}
				index={i}
				interactive={canManage}
				onOpen={openMethod}
				tabIndex={canManage ? (i === roving.value ? 0 : -1) : undefined}
			/>
		</li>
	);

	const total = methods.length;
	const countLabel = `${total} saved payment ${total === 1 ? "method" : "methods"}`;
	const fanned = methods.slice(0, FAN_LIMIT);

	if (total === 0) {
		return (
			<div class="wlt-deck wlt-deck--empty">
				<EmptyBand
					text="No payment methods saved."
					hint={canManage ? "Add one from the action bar below." : undefined}
				/>
			</div>
		);
	}

	return (
		<div class="wlt-deck">
			<div class="wlt-deck__wrap">
				<ul
					class="wlt-deck__list"
					ref={restListRef}
					aria-label="Saved payment methods"
					onKeyDown={onListKeyDown(restListRef, fanned.length)}
				>
					{fanned.map((m, i) => item(m, i, "deck"))}
				</ul>

				<p class="wlt-deck__count wlt-num">{countLabel}</p>

				<Tooltip content="Show all payment methods">
					<button
						type="button"
						class="wlt-deck__expand"
						ref={triggerRef}
						aria-expanded={open ? "true" : "false"}
						aria-label="Show all payment methods"
						onClick={() => (deckExpanded.value = true)}
					>
						{ExpandGlyph}
					</button>
				</Tooltip>
			</div>

			{
				/*
				 * One polite announcement per state change. The count is repeated because the overlay
				 * reveals instruments the resting fan does not show.
				 */
			}
			<div class="ui-visually-hidden" role="status" aria-live="polite">
				{open ? `Payment methods expanded, ${countLabel}` : ""}
			</div>

			{presence.mounted && (
				<BodyPortal>
					<div
						class={cx("wlt-deck", "wlt-deck--expanded")}
						data-state={presence.state}
						style={styleVars({ "--wlt-z": stack.zIndex })}
					>
						<Backdrop visible={presence.state === "open"} onClick={collapse} />
						<div
							class="wlt-deck__wrap"
							ref={panelRef}
							role="dialog"
							aria-modal="true"
							aria-labelledby={countId}
						>
							<p class="wlt-deck__count wlt-num" id={countId}>{countLabel}</p>

							<Tooltip content="Close">
								<button
									type="button"
									class="wlt-deck__expand"
									aria-expanded
									aria-label="Close payment methods"
									onClick={collapse}
								>
									{collapseMark()}
								</button>
							</Tooltip>

							<ul
								class="wlt-deck__list"
								ref={gridListRef}
								aria-label="Saved payment methods"
								onKeyDown={onListKeyDown(gridListRef, total)}
							>
								{methods.map((m, i) => item(m, i, "grid"))}
							</ul>
						</div>
					</div>
				</BodyPortal>
			)}
		</div>
	);
	// #endregion
}
