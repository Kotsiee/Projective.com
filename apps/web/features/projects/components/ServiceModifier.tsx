import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { JSX } from "preact";
import { CheckIcon, ChevronIcon } from "./glyphs.tsx";
import type { ServiceOption } from "../types/projects-types.ts";

/**
 * ServiceModifier — the sleek, permanent, low-contrast dropdown line that appears immediately below
 * the search layout while the **Services** tab is active. It lets a freelancer/team instantly switch
 * between "All services" and a single service's client queue (narrowing the feed to the clients
 * engaged through one service product). A background-free trigger holds the low-contrast register;
 * the menu is a minimal token-only flyout with outside-click + Escape dismissal.
 */

const ALL = "";

export interface ServiceModifierProps {
	services: readonly ServiceOption[];
	/** The active service id, or `""` for all services. */
	value: string;
	onSelect: (serviceId: string) => void;
}

export function ServiceModifier({ services, value, onSelect }: ServiceModifierProps): JSX.Element {
	const open = useSignal(false);
	const root = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open.value) return;
		const onDown = (e: PointerEvent) => {
			if (root.current && !root.current.contains(e.target as Node)) open.value = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") open.value = false;
		};
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open.value]);

	const active = services.find((s) => s.id === value);
	const label = active ? active.name : "All services";

	function pick(id: string): void {
		onSelect(id);
		open.value = false;
	}

	return (
		<div class="proj-modifier" ref={root}>
			<span class="proj-modifier__lead">Showing</span>
			<button
				type="button"
				class="proj-modifier__btn"
				aria-haspopup="listbox"
				aria-expanded={open.value}
				aria-label={`Service queue: ${label}`}
				onClick={() => (open.value = !open.value)}
			>
				<span class="proj-modifier__value">{label}</span>
				<span
					class="proj-modifier__caret"
					data-open={open.value ? "true" : undefined}
					aria-hidden="true"
				>
					{ChevronIcon}
				</span>
			</button>

			{open.value && (
				<div class="proj-modifier__menu" role="listbox" aria-label="Service queue">
					<button
						type="button"
						role="option"
						aria-selected={value === ALL}
						class="proj-modifier__item"
						data-on={value === ALL ? "true" : undefined}
						onClick={() => pick(ALL)}
					>
						<span class="proj-modifier__item-label">All services</span>
						{value === ALL && (
							<span class="proj-modifier__check" aria-hidden="true">{CheckIcon}</span>
						)}
					</button>
					{services.map((svc) => (
						<button
							key={svc.id}
							type="button"
							role="option"
							aria-selected={value === svc.id}
							class="proj-modifier__item"
							data-on={value === svc.id ? "true" : undefined}
							onClick={() => pick(svc.id)}
						>
							<span class="proj-modifier__item-label">{svc.name}</span>
							<span class="proj-modifier__item-count">
								{svc.clientCount} {svc.clientCount === 1 ? "client" : "clients"}
							</span>
							{value === svc.id && (
								<span class="proj-modifier__check" aria-hidden="true">{CheckIcon}</span>
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
