import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { cx } from "../../../core/cx.ts";
import { Popover } from "../../../feedback/islands/Popover.tsx";
import { Tooltip } from "../../../feedback/islands/Tooltip.tsx";
import { Icon } from "../../../icons/components/Icon.tsx";
import { useScheduler } from "./context.ts";
import type { SchedulerTemplate } from "./types.ts";

// #region Props
/** One template the library lists. */
export interface LibraryItem {
	id: string;
	name: string;
	/** Who follows it, as short names ("Profile", "Coaching"), printed as muted meta. */
	usedBy?: readonly string[];
	isDefault?: boolean;
	/** Edited in this session and not saved yet. */
	unsaved?: boolean;
}

/** Props for `AvailabilityScheduler.Library`. */
export interface LibraryProps {
	items: readonly LibraryItem[];
	/** The template open in the scheduler; its row shows the live name. */
	activeId: string | null;
	onSelect: (id: string) => void;
	/** Starting points for a new template, listed under the add button. */
	templates?: readonly SchedulerTemplate[];
	/** Start a new template from one; the add button renders only when supplied. */
	onCreate?: (template: SchedulerTemplate) => void;
}
// #endregion

// #region Library
/**
 * The owner's templates as a list: each row is its name and, as muted meta, the default mark and who
 * follows it. A row opens that template in the scheduler; the add button starts a new one from a
 * starting point.
 */
export function Library(props: LibraryProps): JSX.Element {
	const { items, activeId, onSelect, templates = [], onCreate } = props;
	const { store } = useScheduler();
	const menuOpen = useSignal(false);
	const liveName = store.draft.value.name;

	return (
		<section class="ui-avsched__section" aria-label="Templates">
			<div class="ui-avsched__section-head">
				<h3 class="ui-avsched__heading">Templates</h3>
				{onCreate && templates.length > 0 && (
					<Popover
						open={menuOpen}
						label="New template"
						placement="bottom-end"
						trigger={(api) => (
							<Tooltip content="New template">
								<button
									ref={api.ref as RefObject<HTMLButtonElement>}
									type="button"
									class="ui-button ui-button--text ui-button--size-sm ui-button--icon-only ui-hit"
									aria-label="New template"
									aria-haspopup="dialog"
									aria-expanded={api.expanded}
									aria-controls={api.panelId}
									onClick={api.toggle}
								>
									<span class="ui-button__icon">
										<Icon name="plus" />
									</span>
								</button>
							</Tooltip>
						)}
					>
						<ul class="ui-avsched__menu-list">
							{templates.map((t) => (
								<li key={t.key}>
									<button
										type="button"
										class="ui-avsched__menu-item"
										onClick={() => {
											menuOpen.value = false;
											onCreate(t);
										}}
									>
										<span class="ui-avsched__menu-name">{t.name}</span>
									</button>
								</li>
							))}
						</ul>
					</Popover>
				)}
			</div>
			<ul class="ui-avsched__lib">
				{items.map((item) => {
					const active = item.id === activeId;
					const meta = [item.isDefault ? "Default" : "", ...(item.usedBy ?? [])].filter(Boolean);
					return (
						<li key={item.id}>
							<button
								type="button"
								class={cx("ui-avsched__lib-row", active && "ui-avsched__lib-row--active")}
								aria-current={active ? "true" : undefined}
								onClick={() => onSelect(item.id)}
							>
								<span class="ui-avsched__lib-name">
									{active ? liveName : item.name}
									{item.unsaved && (
										<span class="ui-avsched__lib-dot">
											<span class="ui-visually-hidden">, unsaved changes</span>
										</span>
									)}
								</span>
								{meta.length > 0 && <span class="ui-avsched__lib-meta">{meta.join(" · ")}</span>}
							</button>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
// #endregion
