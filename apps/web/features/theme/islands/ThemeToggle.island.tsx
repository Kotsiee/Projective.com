import { Icon } from "@projective/ui/icons";
import { dsConfig, toggleMode } from "@projective/ui/system";

/**
 * ThemeToggle — a minimal, icon-only light/dark switch (no visible label). Renders a sun in light
 * mode and a moon in dark mode; the accessible name lives in `aria-label`/`title`. Reading
 * `dsConfig.value` re-renders this island when the mode flips across island boundaries.
 */
export default function ThemeToggle() {
	const dark = dsConfig.value.mode === "dark";
	return (
		<button
			type="button"
			class="theme-toggle theme-toggle--icon"
			aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
			title="Toggle theme"
			onClick={() => toggleMode()}
		>
			<Icon name={dark ? "moon" : "sun"} size="md" />
		</button>
	);
}
