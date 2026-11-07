import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { styleVars } from "@ui/core/style.ts";
import { Icon } from "@projective/ui/icons";
import "../styles/files-hub.css";
import { colorName, folderPalette, SWATCH_COLUMNS } from "../core/folder-colors.ts";

export interface FolderColorFieldProps {
	/** The picked colour; `null` is no colour, the folder's default drawing. */
	value: Signal<string | null>;
	/** The id of the visible label that names the group. */
	labelledBy: string;
}

/**
 * FolderColorField — the New folder dialog's optional colour: no colour first, then the same swatches a
 * folder's menu offers, the last picked leading. A radio group with one tab stop, so the arrows move
 * and pick and Tab leaves it, as a native radio set does.
 */
export function FolderColorField({ value, labelledBy }: FolderColorFieldProps): JSX.Element {
	const group = useRef<HTMLDivElement>(null);
	const options: (string | null)[] = [null, ...folderPalette.value];
	const picked = Math.max(0, options.indexOf(value.value));

	function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLElement>, index: number): void {
		const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
		const steps: Record<string, number> = {
			ArrowLeft: rtl ? 1 : -1,
			ArrowRight: rtl ? -1 : 1,
			ArrowUp: -SWATCH_COLUMNS,
			ArrowDown: SWATCH_COLUMNS,
		};
		const step = steps[e.key];
		if (step === undefined) return;
		e.preventDefault();
		const next = (index + step + options.length) % options.length;
		value.value = options[next];
		group.current?.querySelectorAll<HTMLElement>("button")[next]?.focus();
	}

	return (
		<div class="fh-swatches" role="radiogroup" aria-labelledby={labelledBy} ref={group}>
			{options.map((hex, index) => (
				<button
					key={hex ?? "none"}
					type="button"
					class={hex ? "fh-swatch" : "fh-swatch fh-swatch--none"}
					role="radio"
					aria-checked={hex === value.value}
					aria-label={hex ? colorName(hex) : "No colour"}
					tabIndex={index === picked ? 0 : -1}
					style={hex ? styleVars({ "--fh-swatch": hex }) : undefined}
					onClick={() => (value.value = hex)}
					onKeyDown={(e) => onKeyDown(e, index)}
				>
					{hex ? null : <Icon name="close" size="xs" />}
				</button>
			))}
		</div>
	);
}
