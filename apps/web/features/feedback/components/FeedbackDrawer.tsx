import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import type { Signal } from "@preact/signals";
import { Drawer } from "@projective/ui/feedback";
import { createComposeState } from "../core/compose-state.ts";
import type { FeedbackLocation } from "../core/feedback-url.ts";
import {
	FEEDBACK_COMPOSE_FORM_ID,
	FeedbackBoard,
	type FeedbackNavigate,
} from "./FeedbackBoard.tsx";
import { ComposeActions } from "./IdeaComposeForm.tsx";

/** Props for {@link FeedbackDrawer}. */
export interface FeedbackDrawerProps {
	open: Signal<boolean>;
	location: FeedbackLocation;
	navigate: FeedbackNavigate;
	currentHref: string;
	signedIn: boolean;
	/** The drawer was dismissed (close button, Escape or the scrim). */
	onClose: () => void;
}

/**
 * FeedbackDrawer — the feedback board over any page (`?feedback=open`, Decision #272): the overlay
 * family's right `Drawer` at the one `--drawer-w` (Decision #171), a labelled modal dialog that traps
 * focus and gives it back to its opener, with the shared {@link FeedbackBoard} in drawer mode — always
 * the single list, the idea and the suggestion form as second views, the form's commit pinned in the
 * footer. Loaded only when the drawer is first asked for (`FeedbackHost`), so it costs nothing on a
 * page that never opens it.
 */
export default function FeedbackDrawer(props: FeedbackDrawerProps): JSX.Element {
	// Lives as long as the host keeps the drawer mounted, so a half-written idea survives a close.
	const compose = useMemo(createComposeState, []);
	// The footer leaves with the form: once an idea is sent the success state carries its own way on,
	// and a footer that rendered nothing would still draw its hairline.
	const composing = props.location.view === "compose" && props.signedIn &&
		compose.sent.value === null;
	return (
		<Drawer
			visible={props.open}
			position="right"
			header="Feedback & roadmap"
			class="fb-drawer"
			onVisibleChange={(visible) => {
				if (!visible) props.onClose();
			}}
			footer={composing
				? (
					<ComposeActions
						formId={FEEDBACK_COMPOSE_FORM_ID}
						state={compose}
						onCancel={() =>
							props.navigate({ ...props.location, view: "board", idea: null }, "replace")}
					/>
				)
				: null}
		>
			<FeedbackBoard
				mode="drawer"
				location={props.location}
				navigate={props.navigate}
				currentHref={props.currentHref}
				initialBoard={null}
				initialDetail={null}
				signedIn={props.signedIn}
				compose={compose}
			/>
		</Drawer>
	);
}
