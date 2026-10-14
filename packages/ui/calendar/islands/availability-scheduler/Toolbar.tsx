import type { JSX } from "preact";
import { Button } from "../../../fields/components/Button.tsx";
import { SelectButton } from "../../../fields/islands/SelectButton.tsx";
import { Icon } from "../../../icons/components/Icon.tsx";
import { pickOption, useBound, useScheduler } from "./context.ts";
import type { Layer, SchedulerView } from "./types.ts";

const LAYERS: { label: string; value: Layer }[] = [
	{ label: "Working hours", value: "working_hours" },
	{ label: "Calls", value: "call_window" },
];
const SNAPS: { label: string; value: "5" | "15" | "30" }[] = [
	{ label: "5 min", value: "5" },
	{ label: "15 min", value: "15" },
	{ label: "30 min", value: "30" },
];
const VIEWS: { label: string; value: SchedulerView }[] = [
	{ label: "Week", value: "week" },
	{ label: "Month", value: "month" },
];

/** Layer toggle · view (Week | Month) · snap · undo/redo · shortcut help. */
export function Toolbar(): JSX.Element {
	const { store, timezone } = useScheduler();
	const layer = useBound(store.layer, (v): string => v);
	const view = useBound(store.view, (v): string => v);
	const snap = useBound(store.snap, String);

	return (
		<div class="ui-avsched__toolbar" role="group" aria-label="Scheduler tools">
			<SelectButton
				options={LAYERS}
				value={layer}
				onValueChange={(v) => {
					const next = pickOption(LAYERS, v);
					if (next) store.setLayer(next);
				}}
				aria-label="Active layer"
				size="sm"
			/>
			<SelectButton
				options={VIEWS}
				value={view}
				onValueChange={(v) => {
					const next = pickOption(VIEWS, v);
					if (next) store.dispatch({ type: "setView", view: next });
				}}
				aria-label="View"
				size="sm"
			/>
			<SelectButton
				options={SNAPS}
				value={snap}
				onValueChange={(v) => {
					const next = pickOption(SNAPS, v);
					if (next) {
						store.dispatch({
							type: "setSnap",
							snap: next === "5" ? 5 : next === "15" ? 15 : 30,
						});
					}
				}}
				aria-label="Snap"
				size="sm"
			/>
			<span class="ui-avsched__zone">Times in {timezone}</span>
			<div class="ui-avsched__history">
				<Button
					variant="text"
					size="sm"
					iconOnly
					icon={<Icon name="rotate-ccw" />}
					aria-label="Undo"
					aria-keyshortcuts="Control+Z"
					disabled={!store.canUndo.value}
					onClick={store.undo}
				/>
				<Button
					variant="text"
					size="sm"
					iconOnly
					icon={<Icon name="rotate-cw" />}
					aria-label="Redo"
					aria-keyshortcuts="Control+Shift+Z"
					disabled={!store.canRedo.value}
					onClick={store.redo}
				/>
				<Button
					variant="text"
					size="sm"
					iconOnly
					icon={<Icon name="help" />}
					aria-label="Keyboard shortcuts"
					aria-keyshortcuts="?"
					onClick={() => {
						store.shortcutsOpen.value = true;
					}}
				/>
			</div>
		</div>
	);
}
