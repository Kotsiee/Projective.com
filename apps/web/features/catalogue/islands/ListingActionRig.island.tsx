import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/workspace.css";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { consoleHref, type ListingStatus } from "../types/catalogue-types.ts";
import { ListingRemovalDialog, type RemovalKind } from "../components/ListingRemovalDialog.tsx";
import { CatalogueService } from "../core/CatalogueService.ts";
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
	/** The listing's slug. */
	slug: string;
	/** The SSR status and what the publish gate found missing, so the rig paints before hydration. */
	status: ListingStatus;
	missing: readonly string[];
	/** Whether the seller may hard-delete it: no buyer has engaged with it (Decision #221). */
	deletable: boolean;
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
 * neutral outlined utilities; Delete — offered only while no buyer has engaged with the listing — is
 * a quiet danger action; both removals confirm first, worded for what each does. Publish is the teal
 * workflow commit. While the gate is closed, Publish stays focusable but inert, and its
 * `aria-describedby` points at the sentence saying why.
 *
 * Every lifecycle change goes through the store, which saves what the seller typed first. The
 * outcome of the last change (or showcase write) replaces the sentence for a few seconds. A delete
 * leaves for the console.
 */
export default function ListingActionRig(props: ListingActionRigProps): JSX.Element {
	const shown = useSignal<string | null>(null);
	const removal = useSignal<RemovalKind | null>(null);
	const confirming = useSignal(false);
	const deleting = useSignal(false);

	function confirm(kind: RemovalKind): void {
		removal.value = kind;
		confirming.value = true;
	}

	async function runRemoval(): Promise<void> {
		const kind = removal.peek();
		removal.value = null;
		if (kind === "archive") {
			await requestStatus("archived");
			return;
		}
		if (kind !== "delete") return;
		deleting.value = true;
		const res = await CatalogueService.remove(props.slug);
		if (res.ok) {
			globalThis.location.assign(consoleHref({}));
			return;
		}
		deleting.value = false;
		notice.value = res.message ?? "Couldn't delete the listing.";
	}

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
				{props.deletable && (
					<Button
						size="sm"
						variant="text"
						severity="danger"
						label="Delete"
						icon={<Icon name="trash" />}
						loading={deleting.value}
						disabled={busy !== null || deleting.value}
						onClick={() => confirm("delete")}
					/>
				)}
				{status !== "archived" && (
					<Button
						size="sm"
						severity="neutral"
						variant="outlined"
						label="Archive"
						loading={busy === "archived"}
						disabled={busy !== null || deleting.value}
						onClick={() => confirm("archive")}
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
			{removal.value && (
				<ListingRemovalDialog
					visible={confirming}
					kind={removal.value}
					subject={`“${draft.value?.title ?? "this listing"}”`}
					onConfirm={() => void runRemoval()}
					onCancel={() => (removal.value = null)}
				/>
			)}
		</div>
	);
}
