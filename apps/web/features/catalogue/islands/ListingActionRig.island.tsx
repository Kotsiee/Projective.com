import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/workspace.css";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { ListingStatus } from "../types/catalogue-types.ts";
import {
	draft,
	notice,
	readiness,
	requestStatus,
	statusBusy,
	workspaceReady,
} from "../core/workspace-store.ts";
import { readinessSentence } from "../core/workspace-model.ts";

/** Props for {@link ListingActionRig}. */
export interface ListingActionRigProps {
	/** The SSR status and what the publish gate found missing, so the rig paints before hydration. */
	status: ListingStatus;
	missing: readonly string[];
}

const GATE_ID = "cat-ws-gate";
const NOTICE_MS = 6_000;

function publishLabel(status: ListingStatus): string {
	if (status === "archived") return "Restore & publish";
	if (status === "paused") return "Resume";
	return "Publish";
}

/**
 * ListingActionRig — the workspace's middle-nav FOOTER band: the publish gate as one sentence ("Add
 * a cover image and set a price to publish."), then the lifecycle actions. Archive and Pause are
 * neutral outlined utilities; Publish is the teal workflow commit. While the gate is closed,
 * Publish stays focusable but inert, and its `aria-describedby` points at the sentence saying why.
 *
 * Every lifecycle change goes through the store, which saves what the seller typed first. The
 * outcome of the last change (or showcase write) replaces the sentence for a few seconds.
 */
export default function ListingActionRig(props: ListingActionRigProps): JSX.Element {
	const shown = useSignal<string | null>(null);

	useSignalEffect(() => {
		const message = notice.value;
		shown.value = message;
		if (!message) return;
		const timer = setTimeout(() => {
			if (notice.peek() === message) notice.value = null;
		}, NOTICE_MS);
		return () => clearTimeout(timer);
	});

	const ready = workspaceReady.value;
	const status = (ready ? draft.value?.status : null) ?? props.status;
	const missing = (ready ? readiness.value?.missing : null) ?? props.missing;
	const open = missing.length === 0;
	const busy = statusBusy.value;

	const publish = () => {
		if (open && !busy) void requestStatus("published");
	};

	return (
		<div class="cat-ws-rig">
			<p class="cat-ws-rig__gate" id={GATE_ID} data-ready={open ? "true" : undefined}>
				<Icon name={open ? "check" : "circle"} size="sm" />
				<span class="cat-ws-rig__sentence">{shown.value ?? readinessSentence(missing)}</span>
			</p>
			<span class="ui-visually-hidden" role="status">{shown.value ?? ""}</span>

			<div class="cat-ws-rig__actions">
				{status !== "archived" && (
					<Button
						size="sm"
						severity="neutral"
						variant="outlined"
						label="Archive"
						loading={busy === "archived"}
						disabled={busy !== null}
						onClick={() => void requestStatus("archived")}
					/>
				)}
				{status === "published"
					? (
						<Button
							size="sm"
							severity="neutral"
							variant="outlined"
							label="Pause"
							loading={busy === "paused"}
							disabled={busy !== null}
							onClick={() => void requestStatus("paused")}
						/>
					)
					: (
						<Button
							size="sm"
							label={publishLabel(status)}
							loading={busy === "published"}
							aria-disabled={!open || busy !== null}
							aria-describedby={open ? undefined : GATE_ID}
							onClick={publish}
						/>
					)}
			</div>
		</div>
	);
}
