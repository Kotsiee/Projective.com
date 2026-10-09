import type { JSX } from "preact";
import type { Ref } from "preact";
import type { Signal } from "@preact/signals";
import { Button, InputText } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";

/** Props for {@link HubSearch}. */
export interface HubSearchProps {
	query: Signal<string>;
	/** How many sections the query leaves, announced politely. */
	matches: number;
	inputRef?: Ref<HTMLDivElement>;
	/** Enter: open the best match. */
	onSubmit: () => void;
}

/**
 * HubSearch — the `/settings` hub's own search field. It filters the section cards and lists the
 * matching settings inside each, through the same registry search the lane and the modal use.
 */
export function HubSearch(props: HubSearchProps): JSX.Element {
	const q = props.query.value.trim();
	return (
		<div class="stg-hub-search" role="search" ref={props.inputRef}>
			<InputText
				type="search"
				value={props.query}
				placeholder="Search settings"
				aria-label="Search settings (press / to focus)"
				fluid
				start={<Icon name="search" size="sm" />}
				end={q
					? (
						<Button
							variant="text"
							severity="secondary"
							size="sm"
							iconOnly
							icon={<Icon name="close" size="sm" />}
							aria-label="Clear search"
							onClick={() => (props.query.value = "")}
						/>
					)
					: undefined}
				onValueChange={(value: string) => (props.query.value = value)}
				onKeyDown={(event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
					if (event.key === "Enter") {
						event.preventDefault();
						props.onSubmit();
					}
				}}
			/>
			<p class="ui-visually-hidden" role="status">
				{q ? `${props.matches} ${props.matches === 1 ? "section matches" : "sections match"}` : ""}
			</p>
		</div>
	);
}
