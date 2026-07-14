import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

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

	// Close the menu on outside click / Escape.
	useEffect(() => {
		const onDoc = (e: MouseEvent) => {
			if (open.value && rootRef.current && !rootRef.current.contains(e.target as Node)) {
				open.value = false;
			}
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
					class="ex-actions__kebab"
					aria-haspopup="menu"
					aria-expanded={open.value}
					aria-label="More actions"
					onClick={() => (open.value = !open.value)}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<circle cx="12" cy="5" r="1.7" fill="currentColor" />
						<circle cx="12" cy="12" r="1.7" fill="currentColor" />
						<circle cx="12" cy="19" r="1.7" fill="currentColor" />
					</svg>
				</button>

				{open.value && (
					<div class="ex-actions__menu" role="menu" aria-label="Card actions">
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
				)}
			</div>

			<span class="ex-actions__status" role="status" aria-live="polite">{status.value}</span>
		</div>
	);
}

// #region Icons
function PlusIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
		>
			<path d="M12 5v14M5 12h14" />
		</svg>
	);
}
function ShareIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<circle cx="18" cy="5" r="2.4" />
			<circle cx="6" cy="12" r="2.4" />
			<circle cx="18" cy="19" r="2.4" />
			<path d="m8.1 10.8 7.8-4.6M8.1 13.2l7.8 4.6" />
		</svg>
	);
}
function BookmarkIcon({ filled }: { filled: boolean }) {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			fill={filled ? "currentColor" : "none"}
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M6 4.5h12v15l-6-4-6 4z" />
		</svg>
	);
}
function FlagIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M5 21V4h9l-1.2 3.2L14 10H5" />
		</svg>
	);
}
// #endregion
