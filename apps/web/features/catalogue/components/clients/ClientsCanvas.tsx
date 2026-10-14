import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { subscribeDevSeam } from "@web/utils/dev-seam.ts";
import "../../styles/clients.css";
import type { ClientPipeline } from "../../types/catalogue-types.ts";
import type { ClientReadScope } from "../../core/client-model.ts";
import {
	chooseClient,
	CLIENTS_CANVAS_ID,
	type ClientSurface,
	pipelineRevision,
	readPipeline,
} from "../../core/client-store.ts";
import { ClientPipelineBoard } from "./ClientPipelineBoard.tsx";

/** Props for {@link ClientsCanvas}. */
export interface ClientsCanvasProps {
	surface: ClientSurface;
	scope: ClientReadScope;
	/** The buyer the drawer shows. */
	chosen?: string;
	/** The real address of a row, so it works as a plain link. */
	hrefFor: (handle: string) => string;
	/** The way out an empty board offers (back to Listings, back to Edit). */
	emptyAction: { label: string; onPress: () => void };
}

const MINUTE = 60_000;

/**
 * ClientsCanvas — the Clients canvas on either surface: it reads the board for its scope (again when
 * the scope changes, after the drawer writes, and when the dev axis flips) and paints the read's
 * states as plain text on the canvas — loading, a failed read with Try again, an empty pipeline with
 * the way back — or the {@link ClientPipelineBoard}.
 */
export function ClientsCanvas(props: ClientsCanvasProps): JSX.Element {
	const pipeline = useSignal<ClientPipeline | null>(null);
	const error = useSignal<string | null>(null);
	const busy = useSignal(true);
	const attempt = useSignal(0);
	const now = useSignal(Date.now());
	const key = JSON.stringify(props.scope);
	const scopeKey = useSignal(key);
	if (scopeKey.peek() !== key) scopeKey.value = key;

	useEffect(() => {
		const tick = setInterval(() => (now.value = Date.now()), MINUTE);
		const off = subscribeDevSeam(() => attempt.value++);
		return () => {
			clearInterval(tick);
			off();
		};
	}, []);

	useSignalEffect(() => {
		const scope = JSON.parse(scopeKey.value) as ClientReadScope;
		void attempt.value;
		void pipelineRevision.value;
		let live = true;
		busy.value = true;
		void readPipeline(scope).then((res) => {
			if (!live) return;
			busy.value = false;
			if (res.ok && res.data) {
				pipeline.value = res.data;
				error.value = null;
			} else {
				error.value = res.message ?? "We couldn't load your clients just now.";
			}
		});
		return () => {
			live = false;
		};
	});

	const board = pipeline.value;
	const total = board ? board.clients.length : 0;

	return (
		<div class="cat-cl-canvas" id={CLIENTS_CANVAS_ID} tabIndex={-1} aria-busy={busy.value}>
			{error.value && (
				<div class="cat-cl-state" role="alert">
					<p class="cat-cl-state__title">{error.value}</p>
					<p class="cat-cl-state__note">
						{board
							? "The clients below are from the last load that worked."
							: "Nothing was lost; this view just couldn't reach your clients."}
					</p>
					<Button
						label="Try again"
						size="sm"
						severity="neutral"
						variant="outlined"
						onClick={() => attempt.value++}
					/>
				</div>
			)}
			{!board && busy.value && !error.value && (
				<p class="cat-cl-state__note" role="status">Loading clients…</p>
			)}
			{board && total === 0 && (
				<div class="cat-cl-state" role="status">
					<p class="cat-cl-state__title">No clients yet</p>
					<p class="cat-cl-state__note">
						{props.surface === "workspace"
							? "When a buyer asks about, books or buys this listing, they'll show up here."
							: "When buyers ask about, book or buy your listings, they'll show up here."}
					</p>
					<Button
						label={props.emptyAction.label}
						size="sm"
						severity="neutral"
						variant="outlined"
						onClick={props.emptyAction.onPress}
					/>
				</div>
			)}
			{board && total > 0 && (
				<ClientPipelineBoard
					pipeline={board}
					consoleScope={props.surface === "console"}
					chosen={props.chosen}
					hrefFor={props.hrefFor}
					onChoose={(handle) => chooseClient(props.surface, handle)}
					now={now.value}
				/>
			)}
		</div>
	);
}
