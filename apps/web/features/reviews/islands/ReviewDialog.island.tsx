import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Dialog, Message } from "@projective/ui/feedback";
import {
	Button,
	InputText,
	type Option,
	SelectButton,
	StarRatingInput,
	Textarea,
} from "@projective/ui/fields";
import {
	REVIEW_COMMENT_MAX,
	REVIEW_COMMENT_MIN,
	REVIEW_TITLE_MAX,
	type Reviewable,
	reviewStateOf,
} from "@projective/types/reviews";
import { sendReviewWrite } from "../core/review-client.ts";
import "../styles/reviews.css";

/**
 * ReviewDialog — where a client reviews what they completed (Decision #487; DESIGN_SYSTEM §C.1).
 * Addressable: `?review=<project slug>` on the engagement's Overview opens it (ROUTING.md), so the
 * reminder notice, the Overview's Reviews block and a review list's **Edit review** all link the same
 * place. One dialog per page, a bottom sheet below `--bp-md`.
 *
 * It renders the reviewables `reviews.get_reviewables` answered — each provider of the engagement, and
 * the provider of each of the viewer's session seats — and branches on each one's state: `open` writes
 * a review, `reviewed` edits or withdraws it, `locked` (replied to, or its window closed) shows it,
 * `withdrawn` and `closed` say so. One filled control per state. The island decides nothing: the
 * doors refuse what the database would not allow, and the refusal is shown above the footer.
 */
export interface ReviewDialogProps {
	/** The engagement's slug — the page's own and the `?review=` value that opens the dialog. */
	slug: string;
	items: Reviewable[];
	/** Open on first paint: the URL asked for it. */
	initialOpen: boolean;
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function dateOf(iso: string | null | undefined): string {
	return iso ? DATE.format(new Date(iso)) : "";
}

/** The first item worth opening on: one that can still be written or edited, else the first. */
function firstActionable(items: Reviewable[]): number {
	const i = items.findIndex((it) => {
		const s = reviewStateOf(it);
		return s === "open" || s === "reviewed";
	});
	return i < 0 ? 0 : i;
}

export default function ReviewDialog(
	{ slug, items, initialOpen }: ReviewDialogProps,
): JSX.Element | null {
	const visible = useSignal(initialOpen && items.length > 0);
	const picked = useSignal<string | string[]>(String(firstActionable(items)));
	const index = useComputed(() => Number(typeof picked.value === "string" ? picked.value : 0) || 0);
	const seed = items[index.value]?.review;
	const rating = useSignal<number>(seed?.rating ?? 0);
	const title = useSignal<string>(seed?.title ?? "");
	const comment = useSignal<string>(seed?.comment ?? "");
	const confirmWithdraw = useSignal(false);
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);
	const focusRef = useRef<HTMLDivElement>(null);

	if (!items.length) return null;

	/** A different provider picked: the form starts from that provider's review, or empty. */
	const reseed = (value: string | string[]) => {
		const r = items[Number(typeof value === "string" ? value : 0) || 0]?.review;
		rating.value = r?.rating ?? 0;
		title.value = r?.title ?? "";
		comment.value = r?.comment ?? "";
		confirmWithdraw.value = false;
		error.value = null;
	};

	const item = items[index.value] ?? items[0];
	const state = reviewStateOf(item);
	const asClient = item.target_type === "user" || item.target_type === "business";
	const name = item.target?.name ?? (asClient ? "this client" : "this provider");
	const length = comment.value.trim().length;
	// An engagement is reviewed both ways, double-blind (Decision #486 (A)): nobody reads a review on
	// one until the other side's arrives or the window closes.
	const blind = item.anchor_kind === "project";
	const whenPublic = `once ${name} reviews you too, or on ${dateOf(item.closes_at)}`;

	/** Drop `?review=` so a reload does not reopen what was just closed. */
	const forgetAddress = () => {
		const url = new URL(globalThis.location.href);
		if (url.searchParams.get("review") !== slug) return;
		url.searchParams.delete("review");
		globalThis.history.replaceState(globalThis.history.state, "", url);
	};

	const done = () => {
		const url = new URL(globalThis.location.href);
		url.searchParams.delete("review");
		globalThis.location.assign(url.pathname + url.search);
	};

	const save = async () => {
		if (rating.value < 1) {
			error.value = "Choose a rating from one to five stars.";
			return;
		}
		if (length < REVIEW_COMMENT_MIN) {
			error.value = `A review is at least ${REVIEW_COMMENT_MIN} characters.`;
			return;
		}
		busy.value = true;
		error.value = null;
		const payload = {
			rating: rating.value,
			title: title.value.trim() || undefined,
			comment: comment.value.trim(),
		};
		const result = state === "reviewed" && item.review
			? await sendReviewWrite(`/api/reviews/${item.review.id}`, "PATCH", payload)
			: await sendReviewWrite("/api/reviews", "POST", {
				...payload,
				anchorKind: item.anchor_kind,
				anchorId: item.anchor_id,
				targetType: item.target_type,
				targetId: item.target_id,
			});
		busy.value = false;
		if (!result.ok) {
			error.value = result.message;
			return;
		}
		done();
	};

	const withdraw = async () => {
		if (!item.review) return;
		busy.value = true;
		error.value = null;
		const result = await sendReviewWrite(`/api/reviews/${item.review.id}/withdraw`, "POST", {});
		busy.value = false;
		if (!result.ok) {
			error.value = result.message;
			return;
		}
		done();
	};

	const close = () => (visible.value = false);

	const options: Option[] = items.map((it, i) => ({
		value: String(i),
		label: it.target?.name ?? "Provider",
	}));
	const writing = state === "open" || state === "reviewed";

	const footer = confirmWithdraw.value
		? (
			<div class="rv-dialog__actions">
				<Button
					label="Keep it"
					severity="secondary"
					variant="text"
					disabled={busy.value}
					onClick={() => (confirmWithdraw.value = false)}
				/>
				<Button
					label="Withdraw review"
					severity="danger"
					loading={busy.value}
					onClick={() => void withdraw()}
				/>
			</div>
		)
		: writing
		? (
			<div class="rv-dialog__actions">
				{state === "reviewed" && (
					<span class="rv-dialog__actions-start">
						<Button
							label="Withdraw review"
							severity="secondary"
							variant="text"
							disabled={busy.value}
							onClick={() => (confirmWithdraw.value = true)}
						/>
					</span>
				)}
				<Button
					label="Cancel"
					severity="secondary"
					variant="text"
					disabled={busy.value}
					onClick={close}
				/>
				<Button
					label={state === "reviewed" ? "Save changes" : "Post review"}
					loading={busy.value}
					onClick={() => void save()}
				/>
			</div>
		)
		: (
			<div class="rv-dialog__actions">
				<Button label="Close" severity="secondary" variant="text" onClick={close} />
			</div>
		);

	return (
		<Dialog
			visible={visible}
			header={state === "reviewed"
				? "Edit your review"
				: state === "open"
				? "Write a review"
				: "Your review"}
			width="36rem"
			class="rv-dialog"
			initialFocusRef={focusRef}
			onVisibleChange={(open) => {
				if (!open) forgetAddress();
			}}
			footer={footer}
		>
			<div class="rv-dialog__body">
				{items.length > 1 && (
					<div class="rv-dialog__field">
						<span class="rv-dialog__label" aria-hidden="true">Who you are reviewing</span>
						<SelectButton
							options={options}
							value={picked}
							size="sm"
							aria-label="Who you are reviewing"
							onValueChange={reseed}
						/>
					</div>
				)}

				{confirmWithdraw.value
					? (
						<p class="rv-dialog__lead">
							Withdraw your review of{" "}
							{name}? It leaves their profile and the listing, and it stays withdrawn: you can't
							write another for this engagement.
						</p>
					)
					: writing
					? (
						<>
							<p class="rv-dialog__lead">
								{state === "reviewed"
									? `You can change your review of ${name} until ${
										dateOf(item.review?.window_closes_at)
									}, or until they reply.${
										item.review?.revealed ? "" : ` Nobody reads it ${whenPublic}.`
									}`
									: asClient
									? `How was working with ${name} as a client? Your review counts toward their Client Trust Score and shows on their profile ${whenPublic}.`
									: `How was working with ${name}? Your review shows on their profile${
										blind ? ` and on the listing you bought ${whenPublic}` : ""
									}.`}
							</p>
							<div class="rv-dialog__field" ref={focusRef}>
								<span class="rv-dialog__label" aria-hidden="true">Rating</span>
								<StarRatingInput
									value={rating}
									precision={0.5}
									clearable={false}
									aria-label="Rating"
								/>
							</div>
							<div class="rv-dialog__field">
								<label class="rv-dialog__label" for="rv-dialog-title">Headline (optional)</label>
								<InputText
									id="rv-dialog-title"
									value={title}
									maxLength={REVIEW_TITLE_MAX}
									fluid
									placeholder="The one line the next client should read"
								/>
							</div>
							<div class="rv-dialog__field">
								<label class="rv-dialog__label" for="rv-dialog-comment">Your review</label>
								<Textarea
									id="rv-dialog-comment"
									value={comment}
									rows={5}
									autoResize
									maxRows={12}
									maxLength={REVIEW_COMMENT_MAX}
									fluid
									aria-describedby="rv-dialog-count"
									placeholder="What was delivered, how it went, and what the next client should know."
								/>
								<span
									id="rv-dialog-count"
									class="rv-dialog__count"
									data-short={length < REVIEW_COMMENT_MIN ? "true" : undefined}
									aria-live="polite"
								>
									{length < REVIEW_COMMENT_MIN
										? `${
											(REVIEW_COMMENT_MIN - length).toLocaleString("en-US")
										} more characters to go`
										: `${length.toLocaleString("en-US")} / ${
											REVIEW_COMMENT_MAX.toLocaleString("en-US")
										}`}
								</span>
							</div>
							{state === "open" && (
								<p class="rv-dialog__note">
									You can edit it until {dateOf(item.closes_at)}, or until {name} replies.
								</p>
							)}
						</>
					)
					: state === "locked" && item.review
					? (
						<>
							<div class="rv-dialog__quote">
								{item.review.title && <p class="rv-dialog__quotetitle">{item.review.title}</p>}
								<p class="rv-dialog__quotebody">{item.review.comment}</p>
							</div>
							{item.review.reply && (
								<div class="rv-reply">
									<p class="rv-reply__meta">Reply · {dateOf(item.review.replied_at)}</p>
									<p class="rv-reply__body">{item.review.reply}</p>
								</div>
							)}
							<p class="rv-dialog__note">
								{item.review.reply
									? "A review is fixed once it has a reply."
									: `The window to change it closed on ${dateOf(item.review.window_closes_at)}.`}
							</p>
						</>
					)
					: (
						<p class="rv-dialog__lead">
							{state === "withdrawn"
								? `You withdrew your review of ${name}. It no longer shows anywhere.`
								: `The window to review ${name} closed on ${dateOf(item.closes_at)}.`}
						</p>
					)}

				{error.value && (
					<Message severity="danger" variant="subtle" size="sm">{error.value}</Message>
				)}
			</div>
		</Dialog>
	);
}
