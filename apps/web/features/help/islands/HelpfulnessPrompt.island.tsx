import type { JSX } from "preact";
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
type Phase = "ask" | "comment" | "sending" | "thanks" | "thanks-yes" | "thanks-no" | "error";

/**
 * HelpfulnessPrompt — "Was this helpful?" under a help article (P2 §2–§3): plain text and two
 * outlined buttons; a "No" opens an optional 280-character note before it is sent; a sent answer
 * becomes one quiet thank-you line, announced through a polite live region — no toast.
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
	const noteId = `${FEEDBACK_ANCHOR}-note`;
	const countId = `${FEEDBACK_ANCHOR}-count`;

	async function send(helpful: boolean, note?: string): Promise<void> {
		phase.value = "sending";
		failure.value = null;
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
				phase.value = "error";
				return;
			}
			phase.value = helpful ? "thanks-yes" : "thanks-no";
		} catch {
			failure.value = "That didn't go through. Check your connection and try again.";
			phase.value = "error";
		}
	}

	const onChoose = (e: JSX.TargetedMouseEvent<HTMLButtonElement>, helpful: boolean) => {
		e.preventDefault();
		if (helpful) {
			void send(true);
			return;
		}
		phase.value = "comment";
		globalThis.setTimeout(() => document.getElementById(noteId)?.focus(), 0);
	};

	const remaining = HELP_FEEDBACK_COMMENT_MAX - comment.value.length;
	const p = phase.value;

	return (
		<section class="hc-helpful" aria-labelledby={FEEDBACK_ANCHOR}>
			<h2 id={FEEDBACK_ANCHOR} class="hc-after__title">Was this helpful?</h2>

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

			{(p === "ask" || p === "error" || p === "sending") && (
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
							disabled={p === "sending"}
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
							disabled={p === "sending"}
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
						void send(false, comment.value);
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
							onClick={() => void send(false)}
						/>
						<Button type="submit" label="Send" />
					</div>
				</form>
			)}
		</section>
	);
}
