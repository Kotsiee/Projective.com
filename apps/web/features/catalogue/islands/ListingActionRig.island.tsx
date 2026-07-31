import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/catalogue.css";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import {
	AlertIcon,
	ArchiveIcon,
	CheckIcon,
	PauseIcon,
	PublishIcon,
} from "../components/catalogue-glyphs.tsx";
import {
	editorMissing,
	editorReady,
	editorStatus,
	requestStatus,
} from "../core/catalogue-state.ts";
import type { ListingStatus } from "../types/catalogue-types.ts";

/**
 * ListingActionRig — the manage page's middle-nav FOOTER band, which previously did not exist: the
 * resolver required `segs.length === 1`, so `/catalogue/[id]` rendered bandless in both directions and
 * put Publish, Pause and Archive in a static strip that scrolled away at y = −247.
 *
 * The rig pairs the gate with the action it gates. Publish is disabled until the listing is ready, and
 * the reason travels WITH the disabled control — a disabled button that does not say why is a dead end,
 * and the readiness checklist used to live 447px away in a sticky aside that outlived the button.
 *
 * Dumb: it publishes an intent. Only the body may perform it — the body holds the unsaved draft that
 * Publish has to be judged against, so it flushes the autosave first.
 */

export interface ListingActionRigProps {
	/** The SSR status, so the rig paints the right actions before hydration. */
	status: ListingStatus;
}

export default function ListingActionRig(props: ListingActionRigProps): JSX.Element {
	useEffect(() => {
		editorStatus.value = props.status;
	}, []);

	const status = editorStatus.value ?? props.status;
	const ready = editorReady.value;
	const missing = editorMissing.value;
	const published = status === "published";

	return (
		<div class="cat-arig">
			{
				/*
				 * The gate reads as one sentence, not a checklist dump: what is missing, in order, inline.
				 * It carries a glyph as well as a tone, so the state survives a colour-blind overlay.
				 */
			}
			<p class="cat-arig__gate" data-ready={ready ? "true" : undefined} role="status">
				{ready
					? (
						<>
							<CheckIcon size={15} />
							<span>Ready to publish</span>
						</>
					)
					: (
						<>
							<AlertIcon size={15} />
							<span>
								Add {missing.length > 0 ? missing.join(", ").toLowerCase() : "the required details"}
								{" "}
								to publish
							</span>
						</>
					)}
			</p>

			<div class="cat-arig__actions">
				{status !== "archived" && (
					<Button
						variant="text"
						size="sm"
						label="Archive"
						icon={<ArchiveIcon />}
						onClick={() => requestStatus("archived")}
					/>
				)}

				{published
					? (
						<Button
							variant="outlined"
							size="sm"
							label="Pause"
							icon={<PauseIcon />}
							onClick={() => requestStatus("paused")}
						/>
					)
					: (
						<Tooltip
							content={ready
								? "Make this listing public"
								: `Still needed: ${missing.join(", ") || "required details"}`}
							placement="top"
						>
							<span class="cat-arig__pubwrap">
								<Button
									variant="filled"
									severity="primary"
									size="sm"
									label={status === "archived" ? "Restore & publish" : "Publish"}
									icon={<PublishIcon />}
									disabled={!ready}
									onClick={() => requestStatus("published")}
								/>
							</span>
						</Tooltip>
					)}
			</div>
		</div>
	);
}
