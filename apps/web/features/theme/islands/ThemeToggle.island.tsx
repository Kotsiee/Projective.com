import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { dsConfig, toggleMode } from "@projective/ui/system";

/**
 * ThemeToggle — a minimal, icon-only light/dark switch (no visible label). Both glyphs render,
 * stacked: the sun shows in light mode and the moon in dark, swapped by `:root[data-theme]` (set
 * before first paint, so the first frame is right and hydration never animates), and the flip turns
 * one out as the other turns in (`global.css`). The accessible name lives in `aria-label`; a portal
 * `Tooltip` shows the same words on hover/focus. Reading `dsConfig.value` re-renders this island
 * when the mode flips across island boundaries.
 */
export default function ThemeToggle() {
	const dark = dsConfig.value.mode === "dark";
	const label = dark ? "Switch to light theme" : "Switch to dark theme";
	return (
		<Tooltip content={label}>
			<button
				type="button"
				class="theme-toggle theme-toggle--icon"
				aria-label={label}
				onClick={() => toggleMode()}
			>
				<span class="theme-toggle__glyphs" aria-hidden="true">
					<Icon name="sun" size="md" class="theme-toggle__glyph theme-toggle__glyph--sun" />
					<Icon name="moon" size="md" class="theme-toggle__glyph theme-toggle__glyph--moon" />
				</span>
			</button>
		</Tooltip>
	);
}
