import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { Popover } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import "../styles/basket-button.css";

/**
 * AddToBasketButton — a purchasable's Add to basket control and its persistent In basket state
 * (Decision #428). A line that landed settles the control with one spring and a small spark burst
 * (both removed under either reduced-motion channel); while the line is in the basket the control reads
 * In basket and opens the basket instead. Tier 4 (`neutral` outlined) in both states: it sits beside a
 * tier-1 commit, which keeps the region's one fill (DESIGN_SYSTEM §B.8.1 / §B.8.2). With `picker`
 * (Decision #430) the idle control first opens a popover asking which parts to add.
 */
export interface AddToBasketButtonProps {
	/** Whether the open basket already holds this line — the host reads it from the basket store. */
	inBasket: boolean;
	/** Add the line; resolve `true` when it landed, so the control celebrates only a real add. */
	onAdd: () => Promise<boolean> | boolean;
	/** Open the basket (the shell's drawer, else the basket page). */
	onOpenBasket: () => void;
	/** The idle label; In basket replaces it once the line is in. */
	label?: string;
	size?: "sm" | "md";
	disabled?: boolean;
	class?: string;
	/**
	 * Ask what to add before adding: the idle control opens a popover holding what this returns, which
	 * calls `done(true)` once its lines landed (the control then settles) or `done(false)` to close.
	 */
	picker?: (done: (landed: boolean) => void) => JSX.Element;
	/** The popover's accessible name. */
	pickerLabel?: string;
}

const SPARKS = [0, 1, 2, 3, 4, 5];

export function AddToBasketButton(props: AddToBasketButtonProps): JSX.Element {
	const busy = useSignal(false);
	const bursts = useSignal(0);
	const pickerOpen = useSignal(false);
	const wrap = useRef<HTMLSpanElement>(null);
	const size = props.size ?? "sm";
	const label = props.label ?? "Add to basket";

	const add = async () => {
		if (busy.value) return;
		busy.value = true;
		try {
			if (await props.onAdd()) bursts.value += 1;
		} finally {
			busy.value = false;
		}
	};

	const picked = (landed: boolean) => {
		pickerOpen.value = false;
		if (!landed) return;
		bursts.value += 1;
		setTimeout(() => {
			const active = document.activeElement;
			const lost = !active || active === document.body || !!active.closest(".bkb-pop");
			if (lost) wrap.current?.querySelector<HTMLButtonElement>("button")?.focus();
		}, 0);
	};

	const run = bursts.value;
	const idle = props.picker
		? (
			<Popover
				class="bkb-pop"
				placement="top-end"
				label={props.pickerLabel ?? "Choose what to add"}
				open={pickerOpen}
				trigger={(api) => (
					<Button
						severity="neutral"
						variant="outlined"
						rounded
						size={size}
						icon={<Icon name="basket" size="xs" />}
						label={label}
						aria-haspopup="dialog"
						aria-expanded={api.expanded ? "true" : "false"}
						aria-controls={api.panelId}
						disabled={props.disabled}
						triggerRef={api.ref}
						onClick={api.toggle}
					/>
				)}
			>
				{pickerOpen.value && props.picker ? props.picker(picked) : null}
			</Popover>
		)
		: (
			<Button
				severity="neutral"
				variant="outlined"
				rounded
				size={size}
				icon={<Icon name="basket" size="xs" />}
				label={label}
				aria-busy={busy.value || undefined}
				disabled={props.disabled}
				onClick={() => void add()}
			/>
		);

	return (
		<span
			ref={wrap}
			class={`bkb${props.class ? ` ${props.class}` : ""}`}
			data-settle={run === 0 ? undefined : run % 2 === 0 ? "a" : "b"}
		>
			{props.inBasket
				? (
					<Button
						severity="neutral"
						variant="outlined"
						rounded
						size={size}
						icon={<Icon name="check" size="xs" />}
						label="In basket"
						aria-label="In basket. Open your basket"
						aria-haspopup="dialog"
						disabled={props.disabled}
						onClick={props.onOpenBasket}
					/>
				)
				: idle}
			{run > 0
				? (
					<span key={run} class="bkb__burst" aria-hidden="true">
						{SPARKS.map((i) => <i key={i} class="bkb__spark" />)}
					</span>
				)
				: null}
		</span>
	);
}
