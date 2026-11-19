import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button, Textarea } from "@projective/ui/fields";
import { Message } from "@projective/ui/feedback";
import { REVIEW_REPLY_MAX, type ReviewReply, type ReviewViewer } from "@projective/types/reviews";
import { sendReviewWrite } from "../core/review-client.ts";
import "../styles/reviews.css";

/**
 * ReviewReplyThread — what sits under one review on `/view` and `/@handle/reviews` (Decision #487;
 * DESIGN_SYSTEM §C.1): the reviewed side's one public reply, and the viewer's own actions on the
 * review as tier-5 text actions — **Edit review** for its author (the dialog lives on the engagement's
 * Overview), **Reply** or **Edit reply** for whoever answers for its target. Reply opens an inline
 * composer rather than a dialog, so the reply is written beside what it answers.
 *
 * Rendered inside the review lists' islands, so its state is theirs. A post reloads the page: the
 * list is server-rendered from the database, which holds the one reply and refuses a second.
 */
export interface ReviewReplyThreadProps {
	reviewId: string;
	reply?: ReviewReply;
	viewer?: ReviewViewer;
}

export function ReviewReplyThread(
	{ reviewId, reply, viewer }: ReviewReplyThreadProps,
): JSX.Element | null {
	const composing = useSignal(false);
	const body = useSignal(reply?.body ?? "");
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);

	const canReply = !!viewer?.canReply && !reply;
	const canEditReply = !!viewer?.canEditReply && !!reply;
	const editHref = viewer?.canEdit ? viewer.editHref : null;
	if (!reply && !canReply && !editHref) return null;

	const submit = async () => {
		const text = body.value.trim();
		if (!text) {
			error.value = "Write a reply first.";
			return;
		}
		busy.value = true;
		error.value = null;
		const result = await sendReviewWrite(
			`/api/reviews/${reviewId}/reply`,
			reply ? "PATCH" : "POST",
			{
				body: text,
			},
		);
		busy.value = false;
		if (!result.ok) {
			error.value = result.message;
			return;
		}
		globalThis.location.reload();
	};

	return (
		<div class="rv-thread">
			{reply && !composing.value && (
				<div class="rv-reply">
					<p class="rv-reply__meta">
						Reply · <time dateTime={reply.repliedAt}>{reply.dateLabel}</time>
						{reply.edited ? " · edited" : ""}
					</p>
					<p class="rv-reply__body">{reply.body}</p>
				</div>
			)}

			{composing.value
				? (
					<div class="rv-composer">
						<Textarea
							value={body}
							rows={3}
							autoResize
							maxRows={8}
							maxLength={REVIEW_REPLY_MAX}
							fluid
							aria-label={reply ? "Edit your reply" : "Your reply"}
							placeholder="Thank them, or add what the next client should know."
						/>
						{error.value && (
							<Message severity="danger" variant="subtle" size="sm">{error.value}</Message>
						)}
						<div class="rv-composer__foot">
							<span class="rv-composer__count" aria-live="polite">
								{body.value.trim().length.toLocaleString("en-US")} /{" "}
								{REVIEW_REPLY_MAX.toLocaleString("en-US")}
							</span>
							<span class="rv-composer__buttons">
								<Button
									label="Cancel"
									severity="secondary"
									variant="text"
									size="sm"
									disabled={busy.value}
									onClick={() => {
										composing.value = false;
										body.value = reply?.body ?? "";
										error.value = null;
									}}
								/>
								<Button
									label={reply ? "Save reply" : "Post reply"}
									size="sm"
									loading={busy.value}
									onClick={() => void submit()}
								/>
							</span>
						</div>
					</div>
				)
				: (canReply || canEditReply || editHref) && (
					<div class="rv-thread__actions">
						{canReply && (
							<Button
								label="Reply"
								severity="secondary"
								variant="text"
								size="sm"
								onClick={() => (composing.value = true)}
							/>
						)}
						{canEditReply && (
							<Button
								label="Edit reply"
								severity="secondary"
								variant="text"
								size="sm"
								onClick={() => (composing.value = true)}
							/>
						)}
						{editHref && (
							<Button
								label="Edit review"
								severity="secondary"
								variant="text"
								size="sm"
								onClick={() => globalThis.location.assign(editHref)}
							/>
						)}
					</div>
				)}
		</div>
	);
}
