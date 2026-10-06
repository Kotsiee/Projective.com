import type { JSX } from "preact";
import { useId } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { RankedContact } from "@projective/types/messaging";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { canAct, contactMeta, type PersonActionState } from "../core/people-picker.ts";

/**
 * QuickAddRail — a horizontal, scroll-snapped rail of suggested people, each with a one-click action
 * (Decision #145). The people are the server's relationship ranking (`/api/messaging/suggestions`:
 * shared workspace → mutual follow → follow → worked together → messaged), already narrowed by the
 * caller; the rail renders them in that order and never re-ranks.
 *
 * Each card's action reflects {@link PersonActionState}: idle offers `actionLabel`, busy shows the
 * button's own spinner, done and blocked render `doneLabel` disabled. The rail is a plain list of
 * buttons, so Tab walks it and the browser scrolls the focused card into view.
 */

// #region Props
export interface QuickAddRailProps {
	/** The section heading ("Quick add"). */
	heading: string;
	people: readonly RankedContact[];
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	/** The idle action ("Invite", "Send"). */
	actionLabel: string;
	/** The settled action ("Invited", "Sent"). */
	doneLabel: string;
	stateOf: (person: RankedContact) => PersonActionState;
	onAct: (person: RankedContact) => void;
	/** What the rail says when nobody is left to suggest. */
	emptyNote: string;
}
// #endregion

const SKELETONS = [0, 1, 2, 3];

export function QuickAddRail(props: QuickAddRailProps): JSX.Element {
	const headingId = useId();

	function body(): JSX.Element {
		if (props.loading && props.people.length === 0) {
			return (
				<>
					<ul class="quick-add__rail" aria-hidden="true">
						{SKELETONS.map((i) => (
							<li key={i} class="quick-add__person quick-add__person--skeleton">
								<span class="quick-add__skeleton-avatar" />
								<span class="quick-add__skeleton-line" />
							</li>
						))}
					</ul>
					<p class="quick-add__note" role="status">Finding people you know…</p>
				</>
			);
		}
		if (props.error && props.people.length === 0) {
			return (
				<p class="quick-add__note" role="alert">
					{props.error}{" "}
					<button type="button" class="quick-add__retry" onClick={props.onRetry}>Try again</button>
				</p>
			);
		}
		if (props.people.length === 0) return <p class="quick-add__note">{props.emptyNote}</p>;
		return (
			<ul class="quick-add__rail" aria-labelledby={headingId}>
				{props.people.map((person) => {
					const state = props.stateOf(person);
					const settled = state === "done" || state === "blocked";
					const meta = contactMeta(person);
					return (
						<li key={person.id} class="quick-add__person" data-state={state}>
							<UserAvatar
								image={person.avatar ?? undefined}
								label={person.name}
								size={48}
								shape="circle"
							/>
							<span class="quick-add__name" title={person.name}>{person.name}</span>
							{meta && <span class="quick-add__meta" title={meta}>{meta}</span>}
							<Button
								class="quick-add__act"
								size="sm"
								variant={settled ? "text" : "outlined"}
								severity={settled ? "secondary" : undefined}
								label={settled ? props.doneLabel : props.actionLabel}
								icon={<Icon name={settled ? "check" : "plus"} size="sm" />}
								loading={state === "busy"}
								disabled={!canAct(state)}
								aria-label={settled
									? `${person.name} — ${props.doneLabel}`
									: `${props.actionLabel} ${person.name}`}
								onClick={() => canAct(state) && props.onAct(person)}
							/>
						</li>
					);
				})}
			</ul>
		);
	}

	return (
		<section class="quick-add" aria-labelledby={headingId}>
			<h3 class="quick-add__heading" id={headingId}>{props.heading}</h3>
			{body()}
		</section>
	);
}
