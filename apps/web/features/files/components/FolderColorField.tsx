import type { JSX, Ref } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { styleVars } from "@ui/core/style.ts";
import { Icon } from "@projective/ui/icons";
import "../styles/files-hub.css";
import { colorName, fieldPalette, folderPalette, SWATCH_COLUMNS } from "../core/folder-colors.ts";
import { FolderColorPopover } from "./FolderColorPopover.tsx";

export interface FolderColorFieldProps {
	/** The picked colour; `null` is no colour, the folder's default drawing. */
	value: Signal<string | null>;
	/** The id of the visible label that names the group. */
	labelledBy: string;
}

/**
 * FolderColorField — New folder's optional colour, laid out as a folder's menu grid is (Decision
 * #407): no colour first, then the swatches, the last picked leading, and the same `+` for any other
 * from the wheel, which opens the custom colour popover on the `+` itself. A custom colour takes the
 * last swatch, so the choice stays in view. A radio group with one tab stop, so the arrows move and
 * pick and Tab leaves it, as a native radio set does; the `+` is the next stop.
 */
export function FolderColorField({ value, labelledBy }: FolderColorFieldProps): JSX.Element {
	const group = useRef<HTMLDivElement>(null);
	const custom = useSignal(false);
	const options: (string | null)[] = [null, ...fieldPalette(folderPalette.value, value.value)];
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
		group.current?.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus();
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
			<FolderColorPopover
				open={custom}
				placement="bottom-start"
				initial={value.value}
				name="the new folder"
				onCommit={(hex) => (value.value = hex)}
				trigger={(api) => (
					<button
						type="button"
						ref={api.ref as Ref<HTMLButtonElement>}
						class="fh-swatch fh-swatch--add"
						aria-label="Choose a custom colour"
						aria-haspopup="dialog"
						aria-expanded={api.expanded ? "true" : "false"}
						aria-controls={api.expanded ? api.panelId : undefined}
						onClick={api.toggle}
					>
						<Icon name="plus" size="xs" />
					</button>
				)}
			/>
		</div>
	);
}
