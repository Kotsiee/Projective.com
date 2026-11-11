import type { JSX } from "preact";
import { InputText, Textarea } from "@projective/ui/fields";
import type { BlueprintSessionPlanEntry } from "@projective/types/explore";

/** Props for {@link SessionPlanEditor}. */
export interface SessionPlanEditorProps {
	/** How many sessions one booking holds — one row each. */
	count: number;
	/** What the seller has written so far, by position; shorter than {@link count} until filled. */
	plan: readonly BlueprintSessionPlanEntry[];
	onChange: (plan: BlueprintSessionPlanEntry[]) => void;
}

const BLANK: BlueprintSessionPlanEntry = { title: "", description: "" };

/**
 * SessionPlanEditor — what each session of a fixed-count listing covers: one numbered row per
 * session with an optional title and description, read by position (row 1 is session 1). Rows follow
 * the session count. Unboxed rows separated by spacing, like the stage editor's.
 */
export function SessionPlanEditor({ count, plan, onChange }: SessionPlanEditorProps): JSX.Element {
	const patch = (index: number, next: Partial<BlueprintSessionPlanEntry>) => {
		const rows = Array.from(
			{ length: Math.max(plan.length, index + 1) },
			(_, i) => plan[i] ?? BLANK,
		);
		rows[index] = { ...rows[index], ...next };
		onChange(rows);
	};
	return (
		<ol class="cat-offer__sessions" aria-label="Session plan">
			{Array.from({ length: count }, (_, i) => {
				const entry = plan[i] ?? BLANK;
				const n = i + 1;
				return (
					<li class="cat-offer__step" key={i}>
						<div class="cat-offer__step-head">
							<span class="cat-offer__step-number" aria-hidden="true">{n}</span>
							<InputText
								id={`cat-offer-session-${n}-title`}
								value={entry.title}
								onValueChange={(title) => patch(i, { title })}
								maxLength={80}
								placeholder={n === 1 ? "Title, e.g. Discovery" : `Session ${n} title`}
								aria-label={`Session ${n} title`}
								fluid
							/>
						</div>
						<Textarea
							value={entry.description}
							onValueChange={(description) => patch(i, { description })}
							maxLength={600}
							rows={2}
							autoResize
							maxRows={6}
							placeholder="What this session covers"
							aria-label={`Session ${n} description`}
							fluid
						/>
					</li>
				);
			})}
		</ol>
	);
}
