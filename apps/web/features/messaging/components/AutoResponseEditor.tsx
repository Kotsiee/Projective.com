import type { JSX } from "preact";
import { ToggleSwitch } from "@projective/ui/fields";
import { MessagingIcon } from "./messaging-glyphs.tsx";
import type { AutoResponseRule, AutoResponseTrigger } from "../types/messaging-types.ts";

/**
 * AutoResponseEditor — the auto-response rules editor inside the Message Settings modal (task §2D).
 * Each rule sets up a custom automated greeting/inquiry reply for incoming client messages, optionally
 * scoped to a specific Service / Product / keyword, with an `AI-assisted` flag that reserves the plug-in
 * point for a future AI drafter (inert today). Add / edit / remove; fully controlled by the parent
 * (`rules` + `onChange`), so the modal owns the single settings draft.
 */

// #region Props
export interface AutoResponseEditorProps {
	rules: AutoResponseRule[];
	onChange: (rules: AutoResponseRule[]) => void;
}
// #endregion

const TRIGGERS: Array<{ value: AutoResponseTrigger; label: string }> = [
	{ value: "any", label: "Any message" },
	{ value: "service", label: "Service" },
	{ value: "product", label: "Product" },
	{ value: "keyword", label: "Keyword" },
];

/** A deterministic-enough id for a new rule (no `Date.now()` at module scope; fine in an event handler). */
function newRuleId(existing: AutoResponseRule[]): string {
	let n = existing.length + 1;
	while (existing.some((r) => r.id === `ar-custom-${n}`)) n++;
	return `ar-custom-${n}`;
}

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
			message: "",
			aiAssist: false,
		};
		props.onChange([...props.rules, rule]);
	}

	return (
		<div class="msg-ar">
			{props.rules.length === 0 && (
				<p class="msg-ar__empty">
					No auto-responses yet. Add one to greet new inquiries automatically.
				</p>
			)}

			{props.rules.map((rule) => (
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

					<div class="msg-ar__triggers" role="radiogroup" aria-label="Trigger">
						{TRIGGERS.map((t) => (
							<button
								key={t.value}
								type="button"
								role="radio"
								aria-checked={rule.trigger === t.value}
								class="msg-ar__trigger"
								data-on={rule.trigger === t.value ? "true" : undefined}
								onClick={() => update(rule.id, { trigger: t.value })}
							>
								{t.label}
							</button>
						))}
					</div>

					{rule.trigger === "service" && (
						<input
							type="text"
							class="msg-ar__cond"
							placeholder="Service name (e.g. Brand Identity Sprint)"
							value={rule.serviceName ?? ""}
							aria-label="Service"
							onInput={(e) =>
								update(rule.id, { serviceName: (e.target as HTMLInputElement).value })}
						/>
					)}
					{rule.trigger === "product" && (
						<input
							type="text"
							class="msg-ar__cond"
							placeholder="Product name (e.g. Aurora UI Kit)"
							value={rule.productName ?? ""}
							aria-label="Product"
							onInput={(e) =>
								update(rule.id, { productName: (e.target as HTMLInputElement).value })}
						/>
					)}
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
			))}

			<button type="button" class="msg-ar__add" onClick={add}>
				<MessagingIcon name="compose" />
				Add auto-response
			</button>
		</div>
	);
}
