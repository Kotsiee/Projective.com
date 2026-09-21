import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import "../styles/back-nav.css";
import { isModifiedClick } from "../core/routing.ts";
import {
	backLabel,
	ensureTracked,
	navigateBack,
	resolveBackTarget,
} from "../core/explore-history.ts";

/**
 * ExploreBackNav — the contextual **Back** control of the Explore tree, on `/[handle]` and
 * `/view/[id]`: a real anchor to the previous page of the tree (`core/explore-history.ts`), with
 * the filters that page was left with, or to `/explore` when there is no such page.
 *
 * Two presentations of one control. `text` is the arrow + the word "Back" for a page's own header
 * (the profile's breadcrumb position, the entity view's `BackLink` in both of its homes); `icon` is
 * the compact circle for a strip that has no room for a word — the profile's sticky header bands —
 * with the destination in a portal `Tooltip` + `aria-label` (§B.6, never a native `title`).
 *
 * # It is honest before it is smart
 *
 * The server renders it as an anchor to `fallback` — the tree's root, or the profile a listing was
 * opened under — so it works with JavaScript off, and middle-click and open-in-new-tab work on
 * every branch. Hydration then upgrades the `href` to the stack's answer, and the click handler
 * resolves the target AGAIN at press time, because the stack can change between mount and press
 * (a bfcache restore, a filter re-written on the page beneath). The visible word never changes —
 * "Back" is right for every destination — and the destination lives in the accessible name, where
 * a screen reader hears it at focus time rather than as a correction.
 *
 * # It leaves through the browser's own door when it can
 *
 * `navigateBack` uses `history.back()` when the browser's previous entry IS the target — the page
 * comes back from the back-forward cache as the visitor left it, scroll position and all, with no
 * request — and a real navigation otherwise. A modified click (⌘, ctrl, shift, middle) is left to
 * the browser untouched.
 */
export interface ExploreBackNavProps {
	/** `text` — arrow + "Back"; `icon` — a compact circle with the destination in a tooltip. */
	variant: "text" | "icon";
	/** The server-rendered destination: the tree's root, or the profile a listing sits under. */
	fallback: string;
	/** The accessible name for the fallback ("Back to Explore" / "Back to profile"). */
	fallbackLabel: string;
	/** Extra class(es) on the anchor — the host's placement rules. */
	class?: string;
	/** The icon variant's tooltip side (default `bottom`). */
	placement?: "top" | "bottom" | "left" | "right";
}

export default function ExploreBackNav(
	{ variant, fallback, fallbackLabel, class: className, placement = "bottom" }: ExploreBackNavProps,
): JSX.Element {
	const target = useSignal(fallback);
	const label = useSignal(fallbackLabel);

	useEffect(() => {
		ensureTracked();
		const resolve = () => {
			const next = resolveBackTarget(fallback);
			target.value = next;
			label.value = next === fallback ? fallbackLabel : backLabel(next);
		};
		resolve();
		// A restore from the back-forward cache re-mounts nothing; the stack may have moved on.
		globalThis.addEventListener("pageshow", resolve);
		return () => globalThis.removeEventListener("pageshow", resolve);
	}, [fallback, fallbackLabel]);

	function go(e: MouseEvent): void {
		if (isModifiedClick(e)) return;
		e.preventDefault();
		navigateBack(resolveBackTarget(fallback));
	}

	const classes = `ex-back ex-back--${variant}${className ? ` ${className}` : ""}`;

	if (variant === "icon") {
		return (
			<Tooltip content={label.value} placement={placement}>
				<a class={classes} href={target.value} aria-label={label.value} onClick={go}>
					<Icon name="arrow-left" size="md" aria-hidden />
				</a>
			</Tooltip>
		);
	}

	// The visible word stays "Back"; the rest of the name is spoken, not shown (WCAG 2.5.3 holds —
	// the visible text is the start of the accessible name).
	const suffix = label.value.startsWith("Back") ? label.value.slice("Back".length) : "";
	return (
		<a class={classes} href={target.value} onClick={go}>
			<Icon name="arrow-left" size="sm" aria-hidden />
			<span class="ex-back__text">Back</span>
			{suffix && <span class="ui-visually-hidden">{suffix}</span>}
		</a>
	);
}
