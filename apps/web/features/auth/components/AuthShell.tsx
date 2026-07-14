import type { ComponentChildren, JSX } from "preact";
import "../styles/auth.css";
import ThemeToggle from "@web/features/theme/islands/ThemeToggle.island.tsx";

/**
 * AuthShell — the fixed, **non-scrolling** two-column auth frame. The whole surface is pinned to the
 * viewport (`100dvh`, `overflow: hidden`); the left `aside` is the rich interactive summary panel
 * (which owns the single Projective brand mark) and the right `main` carries a minimal top bar (theme
 * toggle only) over the active form. Softness over outlines (DESIGN_SYSTEM.md §B.4): regions read
 * through surface tint, depth, and spacing — the interactive controls inside provide their own
 * affordance.
 */
export interface AuthShellProps {
	/** The active form / step content (right column). */
	children: ComponentChildren;
	/** The left summary panel content (illustration, copy, glass card). */
	aside: ComponentChildren;
	/** Widen the form column (used by the onboarding wizard). */
	wide?: boolean;
	/** Optional footer row pinned under the form. */
	footer?: ComponentChildren;
}

export function AuthShell({ children, aside, wide, footer }: AuthShellProps): JSX.Element {
	return (
		<div class={`auth${wide ? " auth--wide" : ""}`}>
			<aside class="auth__aside" aria-label="Overview">{aside}</aside>

			<section class="auth__main">
				{/* The brand mark lives once, in the aside; the top bar carries only the theme toggle. */}
				<header class="auth__topbar">
					<ThemeToggle />
				</header>

				<div class="auth__stage">
					<div class="auth__panel">{children}</div>
					{footer ? <div class="auth__footer">{footer}</div> : null}
				</div>
			</section>
		</div>
	);
}

/** AuthHeading — the title/subtitle block that opens a form panel (type weight + spacing, no boxes). */
export function AuthHeading(
	{ title, subtitle }: { title: string; subtitle?: ComponentChildren },
): JSX.Element {
	return (
		<div class="auth-heading">
			<h1 class="auth-heading__title">{title}</h1>
			{subtitle ? <p class="auth-heading__subtitle">{subtitle}</p> : null}
		</div>
	);
}
