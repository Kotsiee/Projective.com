import { Issues } from "./Issues.tsx";
import { MonthPreview } from "./MonthPreview.tsx";
import { PresetBar } from "./PresetBar.tsx";
import { Root } from "./Root.tsx";
import { RuleEditor } from "./RuleEditor.tsx";
import { RuleList } from "./RuleList.tsx";
import { ShortcutSheet } from "./ShortcutSheet.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { WeekCanvas } from "./WeekCanvas.tsx";

/**
 * The rule-based availability scheduler (plan §5.4) as a compound component. `Root` owns the store
 * and mounts the shortcut sheet; the parts read it from context and can be arranged freely.
 *
 * ```tsx
 * <AvailabilityScheduler.Root value={preset} onChange={save} engine={engine} weekStartsOn={1}>
 *   <AvailabilityScheduler.PresetBar templates={TEMPLATES} presets={library} binding={binding} />
 *   <AvailabilityScheduler.Toolbar />
 *   <AvailabilityScheduler.WeekCanvas />
 *   <AvailabilityScheduler.MonthPreview />
 *   <AvailabilityScheduler.RuleList />
 *   <AvailabilityScheduler.RuleEditor />
 *   <AvailabilityScheduler.Issues />
 * </AvailabilityScheduler.Root>
 * ```
 */
export const AvailabilityScheduler = Object.assign(Root, {
	Root,
	PresetBar,
	Toolbar,
	WeekCanvas,
	MonthPreview,
	RuleList,
	RuleEditor,
	Issues,
	ShortcutSheet,
});

export type { AvailabilitySchedulerRootProps } from "./Root.tsx";
export type { PresetBarProps } from "./PresetBar.tsx";
export { createSchedulerStore, reduce as reduceScheduler } from "./store.ts";
export type {
	Cursor as SchedulerCursor,
	SchedulerAction,
	SchedulerState,
	SchedulerStore,
	SchedulerStoreOptions,
	Selection as SchedulerSelection,
} from "./store.ts";
export { initialState as initialSchedulerState } from "./reducer.ts";
export { keyToAction, SHORTCUTS as SCHEDULER_SHORTCUTS } from "./keymap.ts";
export type {
	KeyCommand as SchedulerKeyCommand,
	KeyContext as SchedulerKeyContext,
	KeyInput as SchedulerKeyInput,
	ShortcutRow as SchedulerShortcutRow,
} from "./keymap.ts";
export type {
	Band as SchedulerBand,
	BlackoutSpan as SchedulerBlackoutSpan,
	DateRange as SchedulerDateRange,
	Explanation as SchedulerExplanation,
	Issue as SchedulerIssue,
	Layer as SchedulerLayer,
	LayerExplanation as SchedulerLayerExplanation,
	Occurrence as SchedulerOccurrence,
	Preset as SchedulerPreset,
	PresetBinding,
	RRuleReading,
	RRuleWriting,
	RuleCondition as SchedulerRuleCondition,
	RuleDraft as SchedulerRuleDraft,
	RulePattern as SchedulerRulePattern,
	SchedulerBlackout,
	SchedulerEngine,
	SchedulerTemplate,
} from "./types.ts";
