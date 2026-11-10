import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import "../styles/swatch-picker.css";
import { cx } from "../../core/cx.ts";
import { Icon } from "../../icons/components/Icon.tsx";
import { SWATCHES, swatchFor, swatchStep } from "../core/swatches.ts";
import { useControllable } from "../hooks/useControllable.ts";
import type { Bindable, ValueChange } from "../types/mod.ts";

/** Props for {@link SwatchPicker}. */
export interface SwatchPickerProps {
	/** The picked swatch's token name (`--swatch-teal`), or `null` for the default. */
	value?: Bindable<string | null>;
	/** Fired with the new token name, or `null`, on every pick. */
	onValueChange?: ValueChange<string | null>;
	/** `sm` draws the 24px hit target; `md` the `/files` menu's 26px. */
	size?: "sm" | "md";
	disabled?: boolean;
	"aria-label"?: string;
	"aria-labelledby"?: string;
	"aria-describedby"?: string;
	class?: string;
}

/**
 * SwatchPicker — the colour something is drawn in, as two rows of six: "Default" and the eleven hues
 * of the `/files` folder menu (Decision #408). A radio group with one tab stop, as a native radio set
 * is: the arrows move and pick (rows wrap; up and down step a row), Home and End jump, Tab leaves.
 * The picked cell carries a ring drawn outside it, so it reads on every hue; the default cell is a
 * neutral tile with a cross. The value is a token name from {@link SWATCHES}, never a literal colour.
 */
export function SwatchPicker(props: SwatchPickerProps): JSX.Element {
	const { size = "md", disabled, class: className } = props;
	const ctrl = useControllable<string | null>(props.value, null, props.onValueChange);
	const group = useRef<HTMLDivElement>(null);
	const picked = SWATCHES.indexOf(swatchFor(ctrl.signal.value));

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>, index: number) => {
		const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
		const next = swatchStep(e.key, index, rtl);
		if (next === null) return;
		e.preventDefault();
		ctrl.set(SWATCHES[next].token);
		group.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
	};

	return (
		<div
			class={cx("ui-swatches", `ui-swatches--size-${size}`, className)}
			role="radiogroup"
			aria-label={props["aria-label"]}
			aria-labelledby={props["aria-labelledby"]}
			aria-describedby={props["aria-describedby"]}
			aria-disabled={disabled ? "true" : undefined}
			ref={group}
		>
			{SWATCHES.map((swatch, index) => (
				<button
					key={swatch.slug}
					type="button"
					role="radio"
					class={cx("ui-swatches__swatch", `ui-swatches__swatch--${swatch.slug}`)}
					aria-checked={index === picked}
					aria-label={swatch.label}
					tabIndex={index === picked ? 0 : -1}
					disabled={disabled}
					onClick={() => ctrl.set(swatch.token)}
					onKeyDown={(e) => onKeyDown(e, index)}
				>
					{swatch.token === null && <Icon name="close" size="xs" />}
				</button>
			))}
		</div>
	);
}
