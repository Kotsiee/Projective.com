import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Toast, useToast } from "@projective/ui/feedback";
import { noticeMessage, readNoticeParam, withNoticeParam } from "../core/project-notice.ts";

/**
 * ProjectNoticeHost — the client half of the `?notice=` flash: it reads the parameter the redirect
 * carried, says it once, and takes it back out of the address bar.
 *
 * Mounted on `/projects`, which is where every bounced engagement URL lands. It is an island for one
 * reason only — a toast is a client surface — so it renders nothing until it has something to say and
 * costs a page that arrives without a notice exactly one empty hydration root.
 *
 * **The strip is the point.** A flash left in the URL stops being a flash: reloading the page, or
 * sharing the link, replays a message about a navigation that happened once, minutes ago, to somebody
 * else. So the parameter is removed the moment it is read, with `replaceState` rather than a push, so
 * the reader's Back button still goes where they came from instead of onto a duplicate of this page.
 *
 * **`fClientNav: false` is not decoration.** Fresh's client runtime treats any history entry stamped
 * `fClientNav: true` as a partial navigation, and on this app — where partials were removed (root
 * CLAUDE.md §8 Decision #52) — traversing back to one ends in a full `location.reload()`. Rewriting
 * the entry without clearing the flag would turn an ordinary Back press into a document reload.
 */

/** The subset of Fresh's history state this island has an opinion about. */
interface NoticeHistoryState {
	fClientNav?: boolean;
}

export default function ProjectNoticeHost(): JSX.Element | null {
	/** Mounted only once there is a message, and never beside a stack another island already put up. */
	const toastMounted = useSignal(false);
	const toast = useToast();
	/** One notice per navigation: an effect that ran twice must not say the same thing twice. */
	const saidRef = useRef(false);

	useEffect(() => {
		if (saidRef.current) return;
		const raw = readNoticeParam(location.search);
		if (raw === null) return;
		saidRef.current = true;

		// Strip FIRST, so an unrecognised or hand-typed code still leaves the URL clean. It is the one
		// thing that must happen whether or not the value said anything.
		const state = history.state;
		const previous: NoticeHistoryState = state && typeof state === "object"
			? state as NoticeHistoryState
			: {};
		history.replaceState(
			{ ...previous, fClientNav: false },
			"",
			withNoticeParam(location.pathname + location.search + location.hash, null),
		);

		const message = noticeMessage(raw);
		if (message === null) return;
		// A stack already on the page renders from the same module-level signal, so pushing into it is
		// enough; mounting a second one at the same anchor would draw every toast twice.
		if (!document.querySelector(".ui-toast")) toastMounted.value = true;
		toast.show({ severity: "warning", summary: message, life: 5000 });
	}, []);

	return toastMounted.value ? <Toast position="bottom-center" /> : null;
}
