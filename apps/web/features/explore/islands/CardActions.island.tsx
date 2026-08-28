import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import { BodyPortal } from "@projective/ui/overlay";
import { useEdgeDetection } from "@projective/ui/hooks";

/**
 * CardActions — the per-card utility cluster in the card's top-right corner: **Share · Star · kebab**,
 * as one horizontal row.
 *
 * Share and Star used to live inside the kebab menu, which cost two interactions and a decision for
 * the two things a reader does most on a discovery card. They are now direct controls; the menu keeps
 * what is either rare (Report) or contextual (Add to project on a helper card), so the row stays three
 * wide on every card in the family rather than four on some.
 *
 * Every button is icon-only, so each carries all three things §B.8.5 makes a merge gate: an
 * `aria-label`, a portal `Tooltip` (never a native `title`), and a hit target past the 24px floor —
 * 32×32 here. Three unlabelled 16px glyphs in a row is exactly the case the rule exists for: a mouse
 * user has no way to tell Share from Star from More without one.
 *
 * The cluster is revealed on card hover/focus via CSS and pinned open once the menu is engaged. Dumb
 * island: it owns only local interaction state and, for the stub, optimistic client feedback (the
 * clipboard for Share, a local toggle for Star). Star and Add-to-project are auth-gated — a signed-out
 * reader gets a sign-in link rather than a control that silently does nothing. Swap the optimistic
 * handlers for internal API-route calls (`/api/explore/bookmark`, `/report`, `/projects/add`) when
 * those land; islands fetch routes only.
 */
export default function CardActions(
	{ title, href, authed = false, helper = false }: {
		/** The card's title — used in share metadata + action labels. */
		title: string;
		/** The card's canonical relative href — used to build the absolute share URL. */
		href: string;
		/** Whether the current visitor is signed in (gates Star + Add-to-project). */
		authed?: boolean;
		/** Offer "Add to project" in the menu (freelancer/team cards). */
		helper?: boolean;
	},
) {
	const open = useSignal(false);
	const starred = useSignal(false);
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

	/*
	 * Move focus INTO the panel when it opens, and back to the trigger when it closes.
	 *
	 * The panel is body-portalled, so in DOM order it is the last child of `<body>` while its trigger
	 * sits inside a card — measured, 348 tab stops apart on a full Explore page. Without this a
	 * keyboard reader who opens the menu has to tab past every remaining control on the page to reach
	 * the two actions it holds, and `.ex-card:focus-within` stops matching the moment they leave the
	 * card, so the trigger row fades out from under them while the panel stays up.
	 */
	useEffect(() => {
		if (!open.value) return;
		const first = menu.ref.current?.querySelector<HTMLElement>('[role="menuitem"]');
		first?.focus();
		return () => menu.triggerRef.current?.focus();
	}, [open.value]);

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

	function star() {
		starred.value = !starred.value;
		announce(starred.value ? "Saved" : "Removed from saved");
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
			<Tooltip content="Share">
				<button
					type="button"
					class="ex-actions__btn"
					aria-label={`Share ${title}`}
					onClick={share}
				>
					<Icon name="share" />
				</button>
			</Tooltip>

			{
				/*
				 * Star is a claim on the reader's own account, so a signed-out visitor gets the sign-in
				 * link in the same slot rather than a control that toggles and forgets. Same shape, same
				 * position — only the destination differs.
				 */
			}
			{authed
				? (
					<Tooltip content={starred.value ? "Saved" : "Save"}>
						<button
							type="button"
							class="ex-actions__btn"
							aria-label={starred.value ? `Remove ${title} from saved` : `Save ${title}`}
							aria-pressed={starred.value}
							onClick={star}
						>
							<Icon name="star" filled={starred.value} />
						</button>
					</Tooltip>
				)
				: (
					<Tooltip content="Sign in to save">
						<a class="ex-actions__btn" href={signIn} aria-label="Sign in to save this">
							<Icon name="star" />
						</a>
					</Tooltip>
				)}

			<div class="ex-actions__menu-wrap">
				<Tooltip content="More actions">
					<button
						type="button"
						ref={menu.triggerRef}
						class="ex-actions__btn"
						aria-haspopup="menu"
						aria-expanded={open.value}
						aria-label="More actions"
						onClick={() => (open.value = !open.value)}
					>
						<Icon name="kebab" />
					</button>
				</Tooltip>

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
							{helper && (
								authed
									? (
										<button
											type="button"
											class="ex-actions__item"
											role="menuitem"
											onClick={addToProject}
										>
											<Icon name="plus" />
											<span>Add to project</span>
										</button>
									)
									: (
										<a class="ex-actions__item" role="menuitem" href={signIn}>
											<Icon name="plus" />
											<span>Sign in to add to a project</span>
										</a>
									)
							)}

							<button
								type="button"
								class="ex-actions__item ex-actions__item--danger"
								role="menuitem"
								onClick={report}
							>
								<Icon name="flag" />
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
