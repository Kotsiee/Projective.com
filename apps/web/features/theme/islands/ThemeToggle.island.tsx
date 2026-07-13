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
			{dark
				? (
					<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
						<path d="M21 12.8A9 9 0 0 1 11.2 3 7 7 0 1 0 21 12.8Z" />
					</svg>
				)
				: (
					<svg
						viewBox="0 0 24 24"
						width="18"
						height="18"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="4" />
						<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
					</svg>
				)}
		</button>
	);
}
