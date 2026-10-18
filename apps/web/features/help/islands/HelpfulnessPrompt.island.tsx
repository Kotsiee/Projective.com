import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/help.css";
import { HELP_FEEDBACK_COMMENT_MAX } from "@projective/types/community";
import { Button, Textarea } from "@projective/ui/fields";
import {
	FEEDBACK_ANCHOR,
	FEEDBACK_FIELD,
	FEEDBACK_NO,
	FEEDBACK_YES,
} from "../core/feedback-form.ts";

// #region Props
/** Props for {@link HelpfulnessPrompt}. */
export interface HelpfulnessPromptProps {
	/** The article's slug. */
	slug: string;
	/** The article's canonical path — where the no-JavaScript form returns the reader. */
	path: string;
	/** The outcome of a no-JavaScript form post (`?helpful=` on the article), when there was one. */
	outcome?: "thanks" | "error";
}
// #endregion

/** What the block shows. */
type Phase = "ask" | "comment" | "thanks" | "thanks-yes" | "thanks-no" | "error";

/** Which control's answer is on its way: the "Yes", the note's "Send", or its "Skip". */
type Sending = "yes" | "send" | "skip";

/**
 * HelpfulnessPrompt — "Was this helpful?" under a help article (P2 §2–§3): plain text and two
 * outlined buttons; a "No" opens an optional 280-character note before it is sent; a sent answer
 * becomes one quiet thank-you line, announced through a polite live region — no toast.
 *
 * While an answer is on its way, the form that sent it stays mounted: the pressed control is marked
 * busy and every control `aria-disabled` (never `disabled`, which would drop the focus to `<body>`),
 * and a second press is ignored. A note that fails to send keeps its text and shows the error inside
 * its own form. Once the answer lands, focus moves to the block's heading, so a keyboard or
 * screen-reader user stays in the block while the live region reads the thank-you.
 *
 * Without JavaScript it is a real form (`POST /api/help/feedback`, `helpful=yes|no`), and the route
 * answers with a 303 back to this block with `?helpful=thanks`, which the page passes as `outcome`.
 * Votes are anonymous unless the reader is signed in; a comment is screened for contact details
 * before it is stored (Decision #147).
 */
export default function HelpfulnessPrompt(props: HelpfulnessPromptProps): JSX.Element {
	const { slug, path, outcome } = props;
	const phase = useSignal<Phase>(
		outcome === "thanks" ? "thanks" : outcome === "error" ? "error" : "ask",
	);
	const comment = useSignal("");
	const failure = useSignal<string | null>(
		outcome === "error" ? "That didn't go through. Please try again." : null,
	);
	const sending = useSignal<Sending | null>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);
	/** Set when an answer this island sent has landed: the next render moves focus to the heading. */
	const focusHeading = useRef(false);
	const noteId = `${FEEDBACK_ANCHOR}-note`;
	const countId = `${FEEDBACK_ANCHOR}-count`;

	/**
	 * Sends one answer from `from`. On a refusal the reader stays where they were — the Yes/No
	 * buttons, or the note with its text — and the error shows there.
	 */
	async function send(from: Sending, helpful: boolean, note?: string): Promise<void> {
		if (sending.value !== null) return;
		sending.value = from;
		failure.value = null;
		const stay: Phase = from === "yes" ? "error" : "comment";
		try {
			const res = await fetch("/api/help/feedback", {
				method: "POST",
				headers: { "content-type": "application/json", accept: "application/json" },
				body: JSON.stringify({ slug, helpful, ...(note?.trim() ? { comment: note } : {}) }),
			});
			const body = await res.json().catch(() => ({})) as { message?: string };
			if (!res.ok) {
				failure.value = res.status === 429
					? "You've answered a lot in a short time. Please try again later."
					: body.message ?? "That didn't go through. Please try again.";
				phase.value = stay;
				return;
			}
			focusHeading.current = true;
			phase.value = helpful ? "thanks-yes" : "thanks-no";
		} catch {
			failure.value = "That didn't go through. Check your connection and try again.";
			phase.value = stay;
		} finally {
			sending.value = null;
		}
	}

	const onChoose = (e: JSX.TargetedMouseEvent<HTMLButtonElement>, helpful: boolean) => {
		e.preventDefault();
		if (sending.value !== null) return;
		if (helpful) {
			void send("yes", true);
			return;
		}
		failure.value = null;
		phase.value = "comment";
		globalThis.setTimeout(() => document.getElementById(noteId)?.focus(), 0);
	};

	const remaining = HELP_FEEDBACK_COMMENT_MAX - comment.value.length;
	const p = phase.value;
	const busy = sending.value;

	// The answer landed and the form that held the focus is gone: keep the reader in the block.
	useEffect(() => {
		if (!focusHeading.current || !p.startsWith("thanks")) return;
		focusHeading.current = false;
		headingRef.current?.focus();
	}, [p]);

	/**
	 * The marks a control carries while an answer is on its way: inert, and busy if it sent it
	 * (`own` is the answer it sends; `null` for "No", which only opens the note).
	 */
	const pending = (own: Sending | null) => ({
		"aria-disabled": busy !== null ? "true" as const : undefined,
		"aria-busy": busy !== null && busy === own ? "true" as const : undefined,
	});

	return (
		<section class="hc-helpful" aria-labelledby={FEEDBACK_ANCHOR}>
			<h2 id={FEEDBACK_ANCHOR} class="hc-after__title" tabIndex={-1} ref={headingRef}>
				Was this helpful?
			</h2>

			<div role="status" aria-live="polite">
				{p === "thanks" && <p class="hc-helpful__thanks">Thanks for telling us.</p>}
				{p === "thanks-yes" && (
					<p class="hc-helpful__thanks">Thanks for telling us — glad it helped.</p>
				)}
				{p === "thanks-no" && (
					<p class="hc-helpful__thanks">
						Thanks — we'll use this to improve the article. Still stuck?{" "}
						<a class="hc-link" href="/contact?intent=support">Contact support</a>.
					</p>
				)}
			</div>

			{(p === "ask" || p === "error") && (
				<form class="hc-helpful__form" method="post" action="/api/help/feedback">
					<input type="hidden" name={FEEDBACK_FIELD.slug} value={slug} />
					<input type="hidden" name={FEEDBACK_FIELD.back} value={path} />
					<div class="hc-helpful__choices" role="group" aria-labelledby={FEEDBACK_ANCHOR}>
						<Button
							type="submit"
							name={FEEDBACK_FIELD.helpful}
							value={FEEDBACK_YES}
							severity="neutral"
							variant="outlined"
							label="Yes"
							{...pending("yes")}
							onClick={(e: JSX.TargetedMouseEvent<HTMLButtonElement>) =>
								onChoose(e, true)}
						/>
						<Button
							type="submit"
							name={FEEDBACK_FIELD.helpful}
							value={FEEDBACK_NO}
							severity="neutral"
							variant="outlined"
							label="No"
							{...pending(null)}
							onClick={(e: JSX.TargetedMouseEvent<HTMLButtonElement>) =>
								onChoose(e, false)}
						/>
					</div>
					{p === "error" && failure.value && (
						<p class="hc-helpful__error" role="alert">{failure.value}</p>
					)}
				</form>
			)}

			{p === "comment" && (
				<form
					class="hc-helpful__form"
					onSubmit={(e) => {
						e.preventDefault();
						void send("send", false, comment.value);
					}}
				>
					<div class="hc-helpful__field">
						<label class="hc-helpful__label" for={noteId}>
							What was missing? (optional)
						</label>
						<Textarea
							id={noteId}
							rows={3}
							autoResize
							maxRows={6}
							maxLength={HELP_FEEDBACK_COMMENT_MAX}
							aria-describedby={countId}
							value={comment}
							fluid
						/>
						<span id={countId} class="hc-helpful__count">
							{remaining} characters left
						</span>
					</div>
					<div class="hc-helpful__actions">
						<Button
							variant="text"
							severity="secondary"
							label="Skip"
							{...pending("skip")}
							onClick={() => void send("skip", false)}
						/>
						<Button type="submit" label="Send" {...pending("send")} />
					</div>
					{failure.value && <p class="hc-helpful__error" role="alert">{failure.value}</p>}
				</form>
			)}
		</section>
	);
}
