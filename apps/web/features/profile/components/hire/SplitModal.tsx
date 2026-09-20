import type { ComponentChildren, JSX, RefObject } from "preact";
import type { Signal } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";

/**
 * SplitModal — the two-column dialog frame BOTH assignment modals on a `/[handle]` page share: the
 * Service modal (a listing bought from the Hire popover) and the Project modal (a seller assigned
 * from the Add-to-project popover).
 *
 * # One frame, two bodies
 *
 * Header — the selected service's or project's title. LEFT — the buyer's inputs: a message, the
 * seller's own intake fields, and whatever the flow needs to commit (a slot, a stage list). RIGHT
 * — a read-only preview in the `/view` page's own vocabulary, so what the buyer is deciding about
 * is beside the decision. FOOTER — a metadata summary (price · rating · a count) on the leading
 * side and the actions on the trailing side, with exactly ONE filled primary (§B.8.2).
 *
 * The columns are a grid queried against a WRAPPER (`.pf-splitscope`), because a container cannot
 * query itself — put `container-type` on the grid and the phone breakpoint measures `0px`, which is
 * the Decision #101 trap. Below 40rem the two stack in DOM order — the inputs, then the preview
 * under one hairline — never re-ordered with `order`, which moves the box and leaves the reading
 * and tab order behind (§D.7.8).
 *
 * `Dialog` projects into `document.body`, so nothing this frame styles may read a `--pf-*` token
 * (they are scoped to `.pf` and would fall back silently — the `--wlt-*` lesson, Decision #60).
 */
export interface SplitModalProps {
	open: Signal<boolean>;
	title: string;
	/** A one-line qualifier under the title (the format, a status word). */
	subtitle?: string;
	left: ComponentChildren;
	right: ComponentChildren;
	/** The footer's leading summary — price, rating, a count. */
	summary: ComponentChildren;
	/** The footer's trailing actions — one filled primary and a text Cancel. */
	actions: ComponentChildren;
	/** Something the frame should say above both columns — a load failure, a success state. */
	notice?: ComponentChildren;
	/** True while the body is being fetched — the columns render their skeleton copy. */
	loading?: boolean;
	initialFocusRef?: RefObject<HTMLElement>;
	/** The scope both columns render in — what a refusal-focus query walks. */
	bodyRef?: RefObject<HTMLDivElement>;
	onClose: () => void;
	class?: string;
}

export function SplitModal(props: SplitModalProps): JSX.Element {
	const { open, title, subtitle, left, right, summary, actions, notice, loading, onClose } = props;
	return (
		<Dialog
			visible={open}
			header={
				<span class="pf-split__head">
					<span class="pf-split__title">{title}</span>
					{subtitle && <span class="pf-split__subtitle">{subtitle}</span>}
				</span>
			}
			width="min(64rem, calc(100vw - var(--space-6)))"
			class={`pf-split${props.class ? ` ${props.class}` : ""}`}
			initialFocusRef={props.initialFocusRef}
			footer={
				<div class="pf-split__foot">
					<div class="pf-split__summary">{summary}</div>
					<div class="pf-split__actions">{actions}</div>
				</div>
			}
			onVisibleChange={(v) => {
				if (!v) onClose();
			}}
		>
			<div class="pf-splitscope" aria-busy={loading ? "true" : undefined} ref={props.bodyRef}>
				{notice && <div class="pf-split__notice">{notice}</div>}
				<div class="pf-split__grid">
					<div class="pf-split__inputs">{left}</div>
					<aside class="pf-split__preview" aria-label="Preview">{right}</aside>
				</div>
			</div>
		</Dialog>
	);
}
