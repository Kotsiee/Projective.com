import type { JSX } from "preact";
import { useEffect, useMemo } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type {
	FeedbackBoard as FeedbackBoardData,
	FeedbackIdeaDetail,
} from "@projective/types/community";
import { FeedbackBoard } from "../components/FeedbackBoard.tsx";
import type { FeedbackUnavailableCopy } from "../core/feedback-view.ts";
import { createComposeState } from "../core/compose-state.ts";
import {
	FEEDBACK_OVERLAY_PARAM,
	type FeedbackLocation,
	isFeedbackOverlayOpen,
	readFeedbackLocation,
	withFeedbackLocation,
} from "../core/feedback-url.ts";
import {
	currentHref,
	isPushedFeedbackEntry,
	pinHistoryEntry,
	pushFeedbackHref,
	replaceFeedbackHref,
} from "../core/feedback-history.ts";

/** Props for {@link FeedbackPage}. */
export interface FeedbackPageProps {
	/** The server's read of the board for the URL the page was asked for (`null` if it failed). */
	initialBoard: FeedbackBoardData | null;
	/** The idea the URL named, when it named one the reader may see. */
	initialDetail: FeedbackIdeaDetail | null;
	/** Why the idea the URL named will not open, when the server's read refused it. */
	initialDetailError: FeedbackUnavailableCopy | null;
	initialLocation: FeedbackLocation;
	/** The request's path + query — the island's address until it hydrates. */
	initialHref: string;
	signedIn: boolean;
}

/**
 * FeedbackPage — `/feedback`, the board's own shareable page (Decision #272). The island owns the
 * address bar here: a tab or an order is written back with `replaceState` (so a copied link keeps
 * it), opening an idea PUSHES an entry so Back returns to the board, and returning from one steps
 * back over the entry it pushed. Every entry is stamped so a traversal never reloads the document
 * (`feedback-history.ts`). The board itself is the shared {@link FeedbackBoard}.
 */
export default function FeedbackPage(props: FeedbackPageProps): JSX.Element {
	const where = useSignal<FeedbackLocation>(props.initialLocation);
	const href = useSignal(props.initialHref);
	const compose = useMemo(createComposeState, []);

	useEffect(() => {
		// `?feedback=open` asks for the drawer, and this page IS the board: drop the request.
		if (isFeedbackOverlayOpen(location.search)) {
			const url = new URL(currentHref(), location.origin);
			url.searchParams.delete(FEEDBACK_OVERLAY_PARAM);
			replaceFeedbackHref(url.pathname + url.search + url.hash);
		}
		pinHistoryEntry();
		href.value = currentHref();
		const onPop = () => {
			where.value = readFeedbackLocation(location.search);
			href.value = currentHref();
		};
		globalThis.addEventListener("popstate", onPop);
		return () => globalThis.removeEventListener("popstate", onPop);
	}, []);

	function navigate(next: FeedbackLocation, how: "push" | "replace"): void {
		const leaving = where.peek();
		if (leaving.view === "idea" && next.view === "board" && isPushedFeedbackEntry()) {
			history.back();
			return;
		}
		const nextHref = withFeedbackLocation(currentHref(), next, { filters: true, overlay: false });
		if (how === "push") pushFeedbackHref(nextHref);
		else replaceFeedbackHref(nextHref);
		if (next.view !== leaving.view) globalThis.scrollTo?.({ top: 0 });
		where.value = next;
		href.value = currentHref();
	}

	return (
		<div class="fb-page">
			<div class="fb-page__inner">
				<FeedbackBoard
					mode="page"
					location={where.value}
					navigate={navigate}
					currentHref={href.value}
					initialBoard={props.initialBoard}
					initialDetail={props.initialDetail}
					initialDetailError={props.initialDetailError}
					signedIn={props.signedIn}
					compose={compose}
				/>
			</div>
		</div>
	);
}
