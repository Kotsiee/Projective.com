import type { JSX, RefObject } from "preact";
import { useRef } from "preact/hooks";
import { signal, useSignalEffect } from "@preact/signals";
import "../styles/colorpicker.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { useFloating } from "../hooks/useFloating.ts";
import { useDismiss } from "../hooks/useDismiss.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";

// #region Types

/** Serialization of the emitted value string. */
export type ColorFormat = "hex" | "rgb" | "hsb";

interface Rgb {
	r: number;
	g: number;
	b: number;
}
interface Hsb {
	h: number;
	s: number;
	b: number;
}

export interface ColorPickerProps extends BaseFieldProps {
	/** Bound colour string — raw (uncontrolled) or `Signal` (controlled). Default emits hex. */
	value?: Bindable<string>;
	/** Fired whenever the colour changes. */
	onValueChange?: ValueChange<string>;
	/** Render the editing panel inline instead of behind a swatch trigger. */
	inline?: boolean;
	/** Emitted string format (default `hex`). */
	format?: ColorFormat;
	class?: string;
}

// #endregion

// #region Colour conversion (self-contained: hex <-> rgb <-> hsb)

/** Clamp to an integer within `[min, max]`. */
function clampInt(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, Math.round(n)));
}

/** Parse a `#rgb` / `#rrggbb` string into RGB channels (0–255). */
function hexToRgb(hex: string): Rgb {
	let h = hex.replace(/^#/, "").trim();
	if (h.length === 3) h = h.split("").map((c) => c + c).join("");
	const int = parseInt(h.padEnd(6, "0").slice(0, 6), 16);
	return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/** Format RGB channels as a `#rrggbb` string. */
function rgbToHex({ r, g, b }: Rgb): string {
	const to = (n: number) => clampInt(n, 0, 255).toString(16).padStart(2, "0");
	return `#${to(r)}${to(g)}${to(b)}`;
}

/** Convert RGB (0–255) to HSB (h 0–360, s/b 0–100). */
function rgbToHsb({ r, g, b }: Rgb): Hsb {
	const rn = r / 255, gn = g / 255, bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const delta = max - min;
	let h = 0;
	if (delta !== 0) {
		if (max === rn) h = ((gn - bn) / delta) % 6;
		else if (max === gn) h = (bn - rn) / delta + 2;
		else h = (rn - gn) / delta + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	const s = max === 0 ? 0 : (delta / max) * 100;
	return { h: Math.round(h), s: Math.round(s), b: Math.round(max * 100) };
}

/** Convert HSB (h 0–360, s/b 0–100) to RGB (0–255). */
function hsbToRgb({ h, s, b }: Hsb): Rgb {
	const sn = s / 100, bn = b / 100;
	const c = bn * sn;
	const hp = (h % 360) / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	let r1 = 0, g1 = 0, b1 = 0;
	if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
	else if (hp < 2) [r1, g1, b1] = [x, c, 0];
	else if (hp < 3) [r1, g1, b1] = [0, c, x];
	else if (hp < 4) [r1, g1, b1] = [0, x, c];
	else if (hp < 5) [r1, g1, b1] = [x, 0, c];
	else [r1, g1, b1] = [c, 0, x];
	const m = bn - c;
	return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

/** Serialize an HSB colour into the caller-facing string of the chosen format. */
function formatColor(hsb: Hsb, format: ColorFormat): string {
	if (format === "hsb") return `hsb(${hsb.h}, ${hsb.s}%, ${hsb.b}%)`;
	const rgb = hsbToRgb(hsb);
	if (format === "rgb") {
		return `rgb(${clampInt(rgb.r, 0, 255)}, ${clampInt(rgb.g, 0, 255)}, ${
			clampInt(rgb.b, 0, 255)
		})`;
	}
	return rgbToHex(rgb);
}

/** Parse any supported colour string into HSB; returns null when unrecognized. */
function parseColor(input: string): Hsb | null {
	const v = input.trim();
	if (!v) return null;
	const hexMatch = v.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
	if (hexMatch) return rgbToHsb(hexToRgb(hexMatch[1]));
	const rgbMatch = v.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
	if (rgbMatch) {
		return rgbToHsb({ r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) });
	}
	const hsbMatch = v.match(/^hsb?\(\s*(\d+)[,\s]+(\d+)%?[,\s]+(\d+)%?/i);
	if (hsbMatch) {
		return {
			h: Number(hsbMatch[1]) % 360,
			s: clampInt(Number(hsbMatch[2]), 0, 100),
			b: clampInt(Number(hsbMatch[3]), 0, 100),
		};
	}
	return null;
}

// #endregion

/**
 * ColorPicker — a token-driven colour selector adapted from PrimeNG's ColorPicker. Signal-first
 * (pass a `Signal` for controlled use). Presents a saturation/brightness square, a hue slider and a
 * hex input, either inline or behind a swatch trigger that opens a popup. HSB↔RGB↔hex conversion is
 * implemented in-file. The saturation area and hue slider are ARIA `slider`s with arrow-key control;
 * the trigger advertises `aria-haspopup`/`aria-expanded`. The gradient and swatch backgrounds are
 * genuine colour values (the sanctioned exception to the token-only rule for this component).
 */
export function ColorPicker(props: ColorPickerProps): JSX.Element {
	const {
		value,
		onValueChange,
		inline = false,
		format = "hex",
		id,
		name,
		disabled,
		readOnly,
		required,
		size = "md",
		class: className,
		"aria-label": ariaLabel,
		"aria-describedby": ariaDescribedby,
	} = props;

	const ctrl = useControllable<string>(value, "#ff0000", onValueChange);
	const rootId = useId(id, "colorpicker");
	const panelId = `${rootId}-panel`;

	// #region Local state — HSB is the panel's source of truth (survives grey/black precision loss)
	const seedHsb = parseColor(ctrl.get()) ?? { h: 0, s: 100, b: 100 };
	const hsb = useRef(signal<Hsb>(seedHsb)).current;
	const open = useRef(signal(false)).current;
	const lastEmitted = useRef(formatColor(seedHsb, format));

	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const areaRef = useRef<HTMLDivElement>(null);
	const dragging = useRef<"area" | "hue" | null>(null);
	// #endregion

	// #region External-value sync — reparse only when the caller's value diverges from our output
	useSignalEffect(() => {
		const external = ctrl.signal.value;
		if (external === lastEmitted.current) return;
		const parsed = parseColor(external);
		if (parsed) hsb.value = parsed;
	});
	// #endregion

	// #region Overlay wiring
	const floating = useFloating({
		open: open.value && !inline,
		triggerRef: triggerRef as RefObject<HTMLElement>,
		panelRef: panelRef as RefObject<HTMLElement>,
		placement: "bottom-start",
		matchWidth: false,
	});
	useDismiss({
		open: open.value && !inline,
		onDismiss: () => (open.value = false),
		panelRef: panelRef as RefObject<HTMLElement>,
		triggerRef: triggerRef as RefObject<HTMLElement>,
	});
	// #endregion

	// #region Emit
	const emit = (next: Hsb) => {
		hsb.value = next;
		const str = formatColor(next, format);
		lastEmitted.current = str;
		ctrl.set(str);
	};
	// #endregion

	// #region Pointer interaction
	const updateAreaFromPointer = (clientX: number, clientY: number) => {
		const el = areaRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
		emit({ h: hsb.peek().h, s: Math.round(x * 100), b: Math.round((1 - y) * 100) });
	};

	const onAreaPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (disabled || readOnly) return;
		dragging.current = "area";
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		updateAreaFromPointer(e.clientX, e.clientY);
	};
	const onAreaPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (dragging.current !== "area") return;
		updateAreaFromPointer(e.clientX, e.clientY);
	};
	const onAreaPointerUp = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (dragging.current === "area") {
			(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
			dragging.current = null;
		}
	};

	const updateHueFromPointer = (clientX: number, target: HTMLElement) => {
		const rect = target.getBoundingClientRect();
		const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		emit({ ...hsb.peek(), h: Math.round(x * 360) });
	};
	const onHuePointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (disabled || readOnly) return;
		dragging.current = "hue";
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		updateHueFromPointer(e.clientX, e.currentTarget as HTMLElement);
	};
	const onHuePointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (dragging.current !== "hue") return;
		updateHueFromPointer(e.clientX, e.currentTarget as HTMLElement);
	};
	const onHuePointerUp = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (dragging.current === "hue") {
			(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
			dragging.current = null;
		}
	};
	// #endregion

	// #region Keyboard interaction
	const onAreaKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		if (disabled || readOnly) return;
		const cur = hsb.peek();
		let { s, b } = cur;
		switch (e.key) {
			case "ArrowLeft":
				s -= 1;
				break;
			case "ArrowRight":
				s += 1;
				break;
			case "ArrowUp":
				b += 1;
				break;
			case "ArrowDown":
				b -= 1;
				break;
			case "Home":
				s = 0;
				break;
			case "End":
				s = 100;
				break;
			default:
				return;
		}
		e.preventDefault();
		emit({ h: cur.h, s: clampInt(s, 0, 100), b: clampInt(b, 0, 100) });
	};
	const onHueKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		if (disabled || readOnly) return;
		const cur = hsb.peek();
		let h = cur.h;
		switch (e.key) {
			case "ArrowLeft":
			case "ArrowDown":
				h -= 1;
				break;
			case "ArrowRight":
			case "ArrowUp":
				h += 1;
				break;
			case "Home":
				h = 0;
				break;
			case "End":
				h = 360;
				break;
			default:
				return;
		}
		e.preventDefault();
		emit({ ...cur, h: (h + 360) % 360 });
	};
	// #endregion

	// #region Hex/text input
	const onTextInput = (e: JSX.TargetedEvent<HTMLInputElement>) => {
		const parsed = parseColor(e.currentTarget.value);
		if (parsed) emit(parsed);
	};
	// #endregion

	// #region Render helpers
	const renderPanel = (): JSX.Element => {
		const cur = hsb.value;
		const hueColor = rgbToHex(hsbToRgb({ h: cur.h, s: 100, b: 100 }));
		const solid = rgbToHex(hsbToRgb(cur));
		const textValue = formatColor(cur, format);
		return (
			<div
				ref={panelRef}
				id={inline ? undefined : panelId}
				class={cx("ui-colorpicker__panel", inline && "ui-colorpicker__panel--inline")}
				role={inline ? undefined : "dialog"}
				aria-label={inline ? undefined : (ariaLabel ?? "Choose colour")}
				style={inline ? undefined : styleVars({
					"--float-top": floating ? `${floating.top}px` : undefined,
					"--float-left": floating ? `${floating.left}px` : undefined,
				})}
			>
				<div
					ref={areaRef}
					class="ui-colorpicker__area"
					role="slider"
					tabIndex={disabled ? -1 : 0}
					aria-label="Saturation and brightness"
					aria-valuetext={`Saturation ${cur.s}%, brightness ${cur.b}%`}
					aria-valuenow={cur.b}
					aria-valuemin={0}
					aria-valuemax={100}
					style={styleVars({ "--cp-hue": hueColor })}
					onPointerDown={onAreaPointerDown}
					onPointerMove={onAreaPointerMove}
					onPointerUp={onAreaPointerUp}
					onKeyDown={onAreaKeyDown}
				>
					<div class="ui-colorpicker__area-white" />
					<div class="ui-colorpicker__area-black" />
					<div
						class="ui-colorpicker__area-thumb"
						style={styleVars({ "--cp-x": `${cur.s}%`, "--cp-y": `${100 - cur.b}%` })}
					/>
				</div>
				<div class="ui-colorpicker__sliders">
					<div
						class="ui-colorpicker__preview"
						style={styleVars({ "--cp-solid": solid })}
						aria-hidden="true"
					/>
					<div
						class="ui-colorpicker__hue"
						role="slider"
						tabIndex={disabled ? -1 : 0}
						aria-label="Hue"
						aria-valuenow={cur.h}
						aria-valuemin={0}
						aria-valuemax={360}
						onPointerDown={onHuePointerDown}
						onPointerMove={onHuePointerMove}
						onPointerUp={onHuePointerUp}
						onKeyDown={onHueKeyDown}
					>
						<div
							class="ui-colorpicker__hue-thumb"
							style={styleVars({ "--cp-x": `${(cur.h / 360) * 100}%` })}
						/>
					</div>
				</div>
				<input
					type="text"
					class="ui-colorpicker__hex"
					value={textValue}
					aria-label="Colour value"
					disabled={disabled}
					readOnly={readOnly}
					onChange={onTextInput}
				/>
			</div>
		);
	};
	// #endregion

	const solidNow = rgbToHex(hsbToRgb(hsb.value));

	// #region Inline presentation
	if (inline) {
		return (
			<div
				class={cx(
					"ui-colorpicker",
					"ui-colorpicker--inline",
					`ui-colorpicker--size-${size}`,
					disabled && "ui-colorpicker--disabled",
					className,
				)}
				aria-describedby={ariaDescribedby}
			>
				<input type="hidden" name={name} value={ctrl.signal.value} />
				{renderPanel()}
			</div>
		);
	}
	// #endregion

	// #region Popup presentation
	const toggleOpen = () => {
		if (disabled || readOnly) return;
		open.value = !open.value;
	};

	return (
		<div
			class={cx(
				"ui-colorpicker",
				`ui-colorpicker--size-${size}`,
				disabled && "ui-colorpicker--disabled",
				className,
			)}
		>
			<input type="hidden" name={name} value={ctrl.signal.value} required={required} />
			<button
				ref={triggerRef}
				id={rootId}
				type="button"
				class="ui-colorpicker__trigger"
				style={styleVars({ "--cp-solid": solidNow })}
				disabled={disabled}
				aria-haspopup="dialog"
				aria-expanded={open.value}
				aria-controls={panelId}
				aria-label={ariaLabel ?? "Select colour"}
				aria-describedby={ariaDescribedby}
				onClick={toggleOpen}
			>
				<span class="ui-colorpicker__swatch" aria-hidden="true" />
			</button>
			{open.value && renderPanel()}
		</div>
	);
	// #endregion
}
