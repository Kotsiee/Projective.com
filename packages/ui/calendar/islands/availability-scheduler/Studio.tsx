import type { ComponentChildren, JSX } from "preact";
import { Splitter, SplitterPanel } from "../../../layout/islands/Splitter.tsx";
import { useScheduler } from "./context.ts";
import { RuleEditor } from "./RuleEditor.tsx";

// #region Props
/** Props for `AvailabilityScheduler.Studio`. */
export interface StudioProps {
	/** The left pane: templates, settings and rules. */
	side: ComponentChildren;
	/** The main pane — usually `AvailabilityScheduler.Calendar`. */
	children: ComponentChildren;
	/** The right pane, shown only while a rule is open (default `RuleEditor`). */
	detail?: ComponentChildren;
	/** Persists the dragged pane sizes under this key. */
	stateKey?: string;
}
// #endregion

// #region Studio
/**
 * The scheduler's three-pane layout on the package `Splitter`: a narrow side pane, the calendar, and
 * a detail pane that exists only while a rule is open, so the calendar takes its width back the
 * moment the rule is closed. Every gutter drags and takes the arrow keys; below 48rem of container
 * width the panes stack instead.
 */
export function Studio(props: StudioProps): JSX.Element {
	const { side, children, detail = <RuleEditor />, stateKey } = props;
	const { store } = useScheduler();
	const open = store.editing.value !== null;

	return (
		<div class="ui-avsched-studio">
			<Splitter stateKey={stateKey}>
				<SplitterPanel
					size={open ? 20 : 24}
					minSize={14}
					maxSize={36}
					class="ui-avsched-studio__side"
				>
					{side}
				</SplitterPanel>
				<SplitterPanel size={open ? 56 : 76} minSize={36} class="ui-avsched-studio__main">
					{children}
				</SplitterPanel>
				{open && (
					<SplitterPanel size={24} minSize={16} maxSize={40} class="ui-avsched-studio__detail">
						{detail}
					</SplitterPanel>
				)}
			</Splitter>
		</div>
	);
}
// #endregion
