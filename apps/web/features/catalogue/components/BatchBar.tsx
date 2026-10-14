import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { Popover } from "@projective/ui/feedback";
import { Button, InputText } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { PublishIcon } from "./catalogue-glyphs.tsx";
import { batchState, type BatchVerb, clearSelection, selection } from "../core/console-store.ts";
import { runBatch } from "../core/console-actions.ts";
import type { BatchAction } from "../types/catalogue-types.ts";

/**
 * BatchBar — the footer band while listings are selected: how many, then the actions that apply to
 * all of them. Publish is the workflow commit (filled primary); Pause and Archive are neutral
 * utilities; Add to collection asks for the collection's name in a popover; Duplicate and Clear are
 * quiet. A run reports per listing above the canvas (`BatchReport`).
 */

const PUBLISH: BatchVerb = { base: "publish", past: "published" };
const PAUSE: BatchVerb = { base: "pause", past: "paused" };
const ARCHIVE: BatchVerb = { base: "archive", past: "archived" };
const DUPLICATE: BatchVerb = { base: "duplicate", past: "duplicated" };
const COLLECTION_ID = "cat-batch-collection";
const COLLECTION_MAX = 80;

export function BatchBar(): JSX.Element {
	const collectionOpen = useSignal(false);
	const collection = useSignal("");
	const count = selection.value.size;
	const run = batchState.value;
	const busy = (verb: BatchVerb) => run.running && run.verb?.base === verb.base;

	function start(action: BatchAction, verb: BatchVerb): void {
		void runBatch(action, verb);
	}

	function addToCollection(e: JSX.TargetedEvent<HTMLFormElement>): void {
		e.preventDefault();
		const name = collection.value.trim();
		if (!name) return;
		collectionOpen.value = false;
		collection.value = "";
		start({ action: "collection", name }, { base: "add", past: `added to “${name}”` });
	}

	return (
		<div class="cat-batch" role="toolbar" aria-label="Selected listings">
			<span class="cat-batch__count" aria-live="polite">{count} selected</span>
			<div class="cat-batch__actions">
				<Button
					size="sm"
					label="Publish"
					icon={<PublishIcon />}
					loading={busy(PUBLISH)}
					disabled={run.running}
					onClick={() => start({ action: "status", status: "published" }, PUBLISH)}
				/>
				<Button
					size="sm"
					severity="neutral"
					variant="outlined"
					label="Pause"
					icon={<Icon name="pause" />}
					loading={busy(PAUSE)}
					disabled={run.running}
					onClick={() => start({ action: "status", status: "paused" }, PAUSE)}
				/>
				<Button
					size="sm"
					severity="neutral"
					variant="outlined"
					label="Archive"
					icon={<Icon name="archive-box" />}
					loading={busy(ARCHIVE)}
					disabled={run.running}
					onClick={() => start({ action: "status", status: "archived" }, ARCHIVE)}
				/>
				<Popover
					open={collectionOpen}
					placement="top-start"
					class="cat-collect-pop"
					trigger={(api) => (
						<button
							type="button"
							ref={api.ref as RefObject<HTMLButtonElement>}
							class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm"
							disabled={run.running}
							aria-haspopup="dialog"
							aria-expanded={api.expanded}
							aria-controls={api.panelId}
							onClick={api.toggle}
						>
							<span class="ui-button__icon">
								<Icon name="folder" />
							</span>
							<span class="ui-button__label">Add to collection</span>
						</button>
					)}
				>
					<form class="cat-collect" onSubmit={addToCollection}>
						<label class="cat-collect__label" for={COLLECTION_ID}>Collection name</label>
						<InputText
							id={COLLECTION_ID}
							value={collection}
							size="sm"
							maxLength={COLLECTION_MAX}
							placeholder="Spring launch"
							block
						/>
						<Button
							type="submit"
							size="sm"
							label="Add"
							disabled={!collection.value.trim()}
						/>
					</form>
				</Popover>
				<Button
					size="sm"
					variant="text"
					label="Duplicate"
					icon={<Icon name="copy" />}
					loading={busy(DUPLICATE)}
					disabled={run.running}
					onClick={() => start({ action: "duplicate" }, DUPLICATE)}
				/>
				<Button
					size="sm"
					variant="text"
					severity="secondary"
					label="Clear"
					disabled={run.running}
					onClick={clearSelection}
				/>
			</div>
		</div>
	);
}
