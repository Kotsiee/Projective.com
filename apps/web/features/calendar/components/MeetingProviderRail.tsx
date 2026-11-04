import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { MEETING_PROVIDER_LABEL, type MeetingProvider } from "@projective/types/scheduling";
import { GoogleMark, MicrosoftMark } from "@features/shell/components/brand-marks.tsx";

/**
 * MeetingProviderRail — which tool the room is made with, as one segmented rail of marks.
 *
 * A WAI-ARIA radiogroup: one tab stop on the checked segment, Arrow keys move and select, Home/End
 * jump to the ends. Each segment is named by `aria-label` and shows the same name on its portal
 * `Tooltip`, because a mark alone is not a name (§B.6). The marks are `aria-hidden`.
 *
 * Zoom has no brand artwork in `brand-marks.tsx`, so it draws the registry's video glyph; Teams
 * draws the Microsoft mark and Meet the Google mark, which name the vendor rather than the product.
 */
export interface MeetingProviderRailProps {
	value: MeetingProvider;
	onChange: (provider: MeetingProvider) => void;
	/** The id of the visible label this group is named by. */
	labelledBy: string;
}

const RAIL: { value: MeetingProvider; mark: () => JSX.Element }[] = [
	{ value: "google", mark: () => <GoogleMark class="evm-providers__mark" /> },
	{ value: "zoom", mark: () => <Icon name="video-camera" size="sm" class="evm-providers__mark" /> },
	{ value: "microsoft_teams", mark: () => <MicrosoftMark class="evm-providers__mark" /> },
	{ value: "custom", mark: () => <Icon name="link" size="sm" class="evm-providers__mark" /> },
];

export function MeetingProviderRail(props: MeetingProviderRailProps): JSX.Element {
	const checked = RAIL.findIndex((r) => r.value === props.value);

	function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLButtonElement>, i: number): void {
		const n = RAIL.length;
		const next = e.key === "ArrowRight" || e.key === "ArrowDown"
			? (i + 1) % n
			: e.key === "ArrowLeft" || e.key === "ArrowUp"
			? (i - 1 + n) % n
			: e.key === "Home"
			? 0
			: e.key === "End"
			? n - 1
			: -1;
		if (next < 0) return;
		e.preventDefault();
		props.onChange(RAIL[next].value);
		// `closest`, not `parentElement`: each segment sits inside its Tooltip's anchor span.
		e.currentTarget.closest('[role="radiogroup"]')
			?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
	}

	return (
		<div class="evm-providers" role="radiogroup" aria-labelledby={props.labelledBy}>
			{RAIL.map((r, i) => {
				const label = MEETING_PROVIDER_LABEL[r.value];
				const on = i === checked;
				return (
					<Tooltip key={r.value} content={label} density="compact">
						<button
							type="button"
							role="radio"
							class="evm-providers__opt"
							aria-checked={on ? "true" : "false"}
							aria-label={label}
							tabIndex={on || (checked < 0 && i === 0) ? 0 : -1}
							onClick={() => props.onChange(r.value)}
							onKeyDown={(e) => onKeyDown(e, i)}
						>
							{r.mark()}
						</button>
					</Tooltip>
				);
			})}
		</div>
	);
}
