import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import { BodyPortal } from "@projective/ui/overlay";
import { useEdgeDetection } from "@projective/ui/hooks";

/**
 * CardActions — the per-card utility cluster: a kebab (`⋯`) menu holding Share, Bookmark, and Report,
 * plus an optional "Add to project" quick-action for helper entities (freelancers/teams). Revealed on
 * card hover/focus via CSS; the menu itself stays open once toggled. Dumb island — it owns only local
 * interaction state and, for the stub, optimistic client feedback (clipboard for Share; local toggles
 * for the rest). The bookmark + add-to-project actions are gated behind auth: signed-out users get a
 * sign-in link instead of the action. Swap the optimistic handlers for internal API-route calls
 * (`/api/explore/bookmark`, `/report`, `/projects/add`) when those land — islands fetch routes only.
 */
export default function CardActions(
	{ title, href, authed = false, helper = false }: {
		/** The card's title — used in share metadata + action labels. */
		title: string;
		/** The card's canonical relative href — used to build the absolute share URL. */
		href: string;
		/** Whether the current visitor is signed in (gates Bookmark + Add-to-project). */
		authed?: boolean;
		/** Render the "Add to project" helper quick-action (freelancer/team cards). */
		helper?: boolean;
	},
) {
	const open = useSignal(false);
	const bookmarked = useSignal(false);
	const status = useSignal(""); // polite aria-live confirmation
	const rootRef = useRef<HTMLDivElement>(null);

	/*
	 * The panel is body-portalled, not absolutely positioned inside the card. `.ex-card` is
	 * `overflow: clip`, so an in-tree menu was clipped by the card box whenever it opened near the
	 * lower edge — the same trap Decision #50 portalled every shared overlay out of. `bottom-end`
	 * keeps it under the kebab; `useEdgeDetection` flips and clamps it at the viewport.
	 */
	const menu = useEdgeDetection<HTMLButtonElement, HTMLDivElement>({
		open: open.value,
		placement: "bottom-end",
		offset: 8,
	});

	// Close the menu on outside click / Escape. The panel lives outside `rootRef` now that it is
	// portalled, so it needs its own containment test or a click inside the menu would dismiss it.
	useEffect(() => {
		const onDoc = (e: MouseEvent) => {
			if (!open.value) return;
			const t = e.target as Node;
			const inRoot = rootRef.current?.contains(t) ?? false;
			const inPanel = menu.ref.current?.contains(t) ?? false;
			if (!inRoot && !inPanel) open.value = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") open.value = false;
		};
		document.addEventListener("click", onDoc);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("click", onDoc);
			document.removeEventListener("keydown", onKey);
		};
	}, []);

	function announce(msg: string) {
		status.value = msg;
		open.value = false;
	}

	async function share() {
		const url = globalThis.location?.origin ? `${globalThis.location.origin}${href}` : href;
		try {
			if (navigator.share) {
				await navigator.share({ title, url });
				announce("Shared");
				return;
			}
			await navigator.clipboard.writeText(url);
			announce("Link copied");
		} catch {
			announce("");
		}
	}

	function bookmark() {
		bookmarked.value = !bookmarked.value;
		announce(bookmarked.value ? "Saved to your bookmarks" : "Removed from bookmarks");
	}

	function report() {
		announce("Report received — thanks, we'll take a look");
	}

	function addToProject() {
		announce(`${title} added to your active project`);
	}

	const signIn = `/login?redirectTo=${encodeURIComponent(href)}`;

	return (
		<div class="ex-actions" ref={rootRef} data-stop>
			{helper && (
				authed
					? (
						<button
							type="button"
							class="ex-actions__quick"
							aria-label={`Add ${title} to a project`}
							onClick={addToProject}
						>
							<PlusIcon />
						</button>
					)
					: (
						<a class="ex-actions__quick" href={signIn} aria-label="Sign in to add to a project">
							<PlusIcon />
						</a>
					)
			)}

			<div class="ex-actions__menu-wrap">
				<button
					type="button"
					ref={menu.triggerRef}
					class="ex-actions__kebab"
					aria-haspopup="menu"
					aria-expanded={open.value}
					aria-label="More actions"
					onClick={() => (open.value = !open.value)}
				>
					<Icon name="kebab" />
				</button>

				{open.value && (
					<BodyPortal>
						<div
							ref={menu.ref}
							class="ui-anchored ex-actions__menu"
							style={menu.style}
							data-placement={menu.placement}
							role="menu"
							aria-label="Card actions"
						>
						<button type="button" class="ex-actions__item" role="menuitem" onClick={share}>
							<ShareIcon />
							<span>Share</span>
						</button>

						{authed
							? (
								<button
									type="button"
									class="ex-actions__item"
									role="menuitem"
									aria-pressed={bookmarked.value}
									onClick={bookmark}
								>
									<BookmarkIcon filled={bookmarked.value} />
									<span>{bookmarked.value ? "Bookmarked" : "Bookmark"}</span>
								</button>
							)
							: (
								<a class="ex-actions__item" role="menuitem" href={signIn}>
									<BookmarkIcon filled={false} />
									<span>Sign in to bookmark</span>
								</a>
							)}

						<button
							type="button"
							class="ex-actions__item ex-actions__item--danger"
							role="menuitem"
							onClick={report}
						>
							<FlagIcon />
							<span>Report</span>
						</button>
						</div>
					</BodyPortal>
				)}
			</div>

			<span class="ex-actions__status" role="status" aria-live="polite">{status.value}</span>
		</div>
	);
}

// #region Icons
/**
 * Thin adapters onto the shared registry (§B.7). These were four hand-authored `<svg>` roots, and
 * the file was its own smallest proof that per-call-site authoring cannot hold a set together: the
 * plus was drawn at `stroke-width: 2` while its three neighbours sat at 1.8, in the same row of the
 * same card.
 */
const PlusIcon = () => <Icon name="plus" />;
const ShareIcon = () => <Icon name="share" />;
const FlagIcon = () => <Icon name="flag" />;
const BookmarkIcon = ({ filled }: { filled: boolean }) => <Icon name="bookmark" filled={filled} />;
// #endregion
