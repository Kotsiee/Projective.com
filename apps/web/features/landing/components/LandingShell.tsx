import type { ComponentChildren, JSX } from "preact";
import { PAGE_CANVAS_MAIN_ID } from "@projective/ui/navigation";
import { PublicFooter } from "@features/marketing/components/PublicFooter.tsx";
import LandingHeader from "@features/landing/islands/LandingHeader.island.tsx";

/** Props for {@link LandingShell}. */
export interface LandingShellProps {
	/** Whether the visitor is signed in — the pill then offers "Open app" instead of signing in. */
	authenticated: boolean;
	/** The page the visitor is on (path + query), threaded into "Sign in" as its `redirectTo`. */
	returnTo: string;
	/** The page body. */
	children: ComponentChildren;
}

/**
 * LandingShell — the off-system chrome of `/` and `/features` (Decision #280; `flows/LANDING.md`
 * §2, §4.0), rendered by the `(public)` layout for guests and signed-in visitors alike in place of
 * GuestShell / UserShell.
 *
 * `.lp-root` is the full-bleed canvas the `--lp-*` tokens are scoped to. Inside it: the skip link
 * "Skip to main content" (the first Tab stop) aimed at the app's one skip-link target,
 * `PAGE_CANVAS_MAIN_ID` (Decision #285 (C)); the floating header pill ({@link LandingHeader}); and
 * the `<main>` landmark. The unchanged {@link PublicFooter} (Decision #13) renders OUTSIDE
 * `.lp-root`, so no landing token reaches the footer and no footer-local `--lp-*` token reaches the
 * landing (Decision #285 (B)).
 */
export function LandingShell(
	{ authenticated, returnTo, children }: LandingShellProps,
): JSX.Element {
	return (
		<>
			<div class="lp-root">
				<a class="lp-skip" href={`#${PAGE_CANVAS_MAIN_ID}`}>Skip to main content</a>
				<LandingHeader authenticated={authenticated} returnTo={returnTo} />
				<main class="lp-main" id={PAGE_CANVAS_MAIN_ID} tabIndex={-1}>
					{children}
				</main>
			</div>
			<PublicFooter />
		</>
	);
}
