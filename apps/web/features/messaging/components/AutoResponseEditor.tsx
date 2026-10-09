import type { JSX } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/auto-response.css";
import { Select, ToggleSwitch } from "@projective/ui/fields";
import type { OptionGroup } from "@projective/ui/fields";
import { MessagingIcon } from "./messaging-glyphs.tsx";
import type { AutoResponseRule, AutoResponseStatus } from "../types/messaging-types.ts";

/**
 * AutoResponseEditor — the away-reply rules editor of Settings → Messaging (Decisions #151, #156).
 * Each rule answers one kind of inbound message (`comms.tg_dm_auto_reply` sends it, most specific
 * rule first, once per conversation per day): a first message, a keyword, a service inquiry, a
 * product inquiry or a hiring invitation — or any message while the person is away, busy, out of
 * hours or on holiday. A rule can be limited to dates; a holiday rule needs them. The `AI-assisted`
 * flag reserves the plug-in point for a future drafter (inert today). Fully controlled by the parent
 * (`rules` + `onChange`), so the section owns the single settings draft.
 */

// #region Props
export interface AutoResponseEditorProps {
	rules: AutoResponseRule[];
	onChange: (rules: AutoResponseRule[]) => void;
}
// #endregion

// #region Choices
/** One value of the "When" picker: a trigger, or `status:<condition>`. */
type WhenValue = string;

const WHEN_OPTIONS: OptionGroup[] = [
	{
		label: "When someone writes",
		items: [
			{
				value: "any",
				label: "First message",
				description: "A conversation you haven't replied in yet",
			},
			{
				value: "keyword",
				label: "A keyword",
				description: "Their message contains a word you choose",
			},
			{
				value: "service",
				label: "A service inquiry",
				description: "Someone asks about your services",
			},
			{
				value: "product",
				label: "A product inquiry",
				description: "Saved now — starts once inquiries carry their product",
			},
			{
				value: "project_invitation",
				label: "A project invitation",
				description: "A client invites you to their project",
			},
		],
	},
	{
		label: "While you're",
		items: [
			{ value: "status:away", label: "Away", description: "While your notifications are paused" },
			{
				value: "status:busy",
				label: "Busy",
				description: "During a call, event or blocked-out time",
			},
			{
				value: "status:out_of_hours",
				label: "Out of hours",
				description: "Outside your published working hours",
			},
			{ value: "status:holiday", label: "On holiday", description: "Between the dates you set" },
		],
	},
];

function whenOf(rule: AutoResponseRule): WhenValue {
	return rule.trigger === "status" && rule.statusCondition
		? `status:${rule.statusCondition}`
		: rule.trigger;
}

/** The rule fields a "When" choice sets — every other scope column cleared. */
function patchForWhen(value: WhenValue): Partial<AutoResponseRule> {
	const base: Partial<AutoResponseRule> = {
		serviceId: null,
		serviceName: null,
		productId: null,
		productName: null,
		statusCondition: null,
	};
	if (value.startsWith("status:")) {
		return {
			...base,
			trigger: "status",
			statusCondition: value.slice(7) as AutoResponseStatus,
			keyword: null,
		};
	}
	return {
		...base,
		trigger: value as AutoResponseRule["trigger"],
		keyword: value === "keyword" ? "" : null,
	};
}

/** An ISO instant → the `datetime-local` value in this device's zone (`2026-10-28T09:00`). */
function toLocalInput(iso: string | null): string {
	if (!iso) return "";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${
		pad(date.getHours())
	}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` value (this device's zone) → an ISO instant, or `null` when empty. */
function fromLocalInput(value: string): string | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The "When" picker, bound to a signal that follows the rule (a Discard redraws it). */
function WhenPicker(
	props: { value: WhenValue; onChange: (value: WhenValue) => void },
): JSX.Element {
	const value = useSignal(props.value);
	useLayoutEffect(() => {
		if (value.peek() !== props.value) value.value = props.value;
	}, [props.value]);
	return (
		<Select
			options={WHEN_OPTIONS}
			grouping
			value={value}
			panelWidth="auto"
			aria-label="When this reply is sent"
			onValueChange={(next) => next && props.onChange(next)}
		/>
	);
}

/** A deterministic-enough id for a new rule (no `Date.now()` at module scope; fine in an event handler). */
function newRuleId(existing: AutoResponseRule[]): string {
	let n = existing.length + 1;
	while (existing.some((r) => r.id === `ar-custom-${n}`)) n++;
	return `ar-custom-${n}`;
}
// #endregion

export function AutoResponseEditor(props: AutoResponseEditorProps): JSX.Element {
	function update(id: string, patch: Partial<AutoResponseRule>): void {
		props.onChange(props.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
	}
	function remove(id: string): void {
		props.onChange(props.rules.filter((r) => r.id !== id));
	}
	function add(): void {
		const rule: AutoResponseRule = {
			id: newRuleId(props.rules),
			enabled: true,
			name: "New auto-response",
			trigger: "any",
			serviceId: null,
			serviceName: null,
			productId: null,
			productName: null,
			keyword: null,
			statusCondition: null,
			startsAt: null,
			endsAt: null,
			message: "",
			aiAssist: false,
		};
		props.onChange([...props.rules, rule]);
	}

	return (
		<div class="msg-ar">
			{props.rules.length === 0 && (
				<p class="msg-ar__empty">
					No auto-responses yet. Add one to greet new inquiries or answer while you're away.
				</p>
			)}

			{props.rules.map((rule) => {
				const holiday = rule.trigger === "status" && rule.statusCondition === "holiday";
				const windowId = `msg-ar-window-${rule.id}`;
				return (
					<div key={rule.id} class="msg-ar__rule" data-off={!rule.enabled ? "true" : undefined}>
						<div class="msg-ar__rule-head">
							<input
								type="text"
								class="msg-ar__name"
								value={rule.name}
								aria-label="Rule name"
								onInput={(e) =>
									update(rule.id, { name: (e.target as HTMLInputElement).value })}
							/>
							<ToggleSwitch
								value={rule.enabled}
								onValueChange={(enabled) =>
									update(rule.id, { enabled })}
								aria-label={`Enable ${rule.name}`}
							/>
							<button
								type="button"
								class="msg-ar__remove"
								aria-label={`Remove ${rule.name}`}
								onClick={() =>
									remove(rule.id)}
							>
								<MessagingIcon name="trash" />
							</button>
						</div>

						<label class="msg-ar__when">
							<span class="msg-ar__label">Send this reply</span>
							<WhenPicker
								value={whenOf(rule)}
								onChange={(value) => update(rule.id, patchForWhen(value))}
							/>
						</label>

						{rule.trigger === "keyword" && (
							<input
								type="text"
								class="msg-ar__cond"
								placeholder="Keyword to match (e.g. pricing)"
								value={rule.keyword ?? ""}
								aria-label="Keyword"
								onInput={(e) => update(rule.id, { keyword: (e.target as HTMLInputElement).value })}
							/>
						)}

						<fieldset class="msg-ar__window" aria-describedby={windowId}>
							<legend class="msg-ar__label">
								{holiday ? "Holiday dates" : "Only between (optional)"}
							</legend>
							<div class="msg-ar__window-fields">
								<input
									type="datetime-local"
									class="msg-ar__cond"
									value={toLocalInput(rule.startsAt)}
									required={holiday}
									aria-label="Starts"
									onInput={(e) =>
										update(rule.id, {
											startsAt: fromLocalInput((e.target as HTMLInputElement).value),
										})}
								/>
								<input
									type="datetime-local"
									class="msg-ar__cond"
									value={toLocalInput(rule.endsAt)}
									required={holiday}
									aria-label="Ends"
									onInput={(e) =>
										update(rule.id, {
											endsAt: fromLocalInput((e.target as HTMLInputElement).value),
										})}
								/>
							</div>
							<p id={windowId} class="msg-ar__hint">
								{holiday
									? "Replies go out from the first date to the last, in your time zone."
									: "Leave empty to reply whenever the rule matches."}
							</p>
						</fieldset>

						<textarea
							class="msg-ar__message"
							rows={3}
							placeholder="Automated reply…"
							value={rule.message}
							aria-label="Auto-response message"
							onInput={(e) => update(rule.id, { message: (e.target as HTMLTextAreaElement).value })}
						/>

						<label class="msg-ar__ai">
							<ToggleSwitch
								value={rule.aiAssist}
								onValueChange={(aiAssist) => update(rule.id, { aiAssist })}
								aria-label="AI-assisted"
							/>
							<span class="msg-ar__ai-label">
								<MessagingIcon name="robot" />
								AI-assisted reply
								<span class="msg-ar__ai-soon">soon</span>
							</span>
						</label>
					</div>
				);
			})}

			<button type="button" class="msg-ar__add" onClick={add}>
				<MessagingIcon name="compose" />
				Add auto-response
			</button>
		</div>
	);
}
