/**
 * @projective/ui/fields — form controls, actions & adornments (DESIGN_SYSTEM.md §C.1).
 *
 * A full PrimeNG-parity control set adapted to the Projective contract: Pure CSS + strict BEM,
 * token-only (`var(--*)`), signal-first (`@preact/signals`), with comprehensive ARIA + keyboard and
 * reduced-motion honoured throughout. Interactive controls live in `islands/`; zero-JS adornments
 * and the Button in `components/`; the field wrapper in `wrappers/`. Shared state/positioning logic
 * lives in `hooks/`, shared vocabulary in `types/`.
 *
 * Every bound control accepts the {@link Bindable} value contract — a raw value (uncontrolled) or a
 * `Signal<T>` (controlled) — via the `useControllable` hook. PrimeNG-familiar aliases are provided
 * where our canonical name differs (`Dropdown`→`Select`, `InputSwitch`→`ToggleSwitch`).
 */

// #region Shared vocabulary & hooks
export type {
	BaseFieldProps,
	Bindable,
	FieldSize,
	FieldStatus,
	FieldVariant,
	Option,
	OptionGroup,
	Severity,
	ValueChange,
} from "./types/mod.ts";

export { useControllable } from "./hooks/useControllable.ts";
export type { Controllable } from "./hooks/useControllable.ts";
export { useId } from "./hooks/useId.ts";
export { useDismiss } from "./hooks/useDismiss.ts";
export type { DismissOptions } from "./hooks/useDismiss.ts";
export { useFloating } from "./hooks/useFloating.ts";
export type { FloatingState, Placement, UseFloatingOptions } from "./hooks/useFloating.ts";
export { useListNavigation } from "./hooks/useListNavigation.ts";
export type { ListNavigation } from "./hooks/useListNavigation.ts";
// #endregion

// #region Buttons & actions
export { Button, type ButtonProps, type ButtonVariant } from "./components/Button.tsx";
export { type MenuAction, SplitButton, type SplitButtonProps } from "./islands/SplitButton.tsx";
export {
	SpeedDial,
	type SpeedDialDirection,
	type SpeedDialProps,
	type SpeedDialType,
} from "./islands/SpeedDial.tsx";
// #endregion

// #region Text inputs & adornments
export { InputText, type InputTextProps } from "./islands/InputText.tsx";
export { Textarea, type TextareaProps } from "./islands/Textarea.tsx";
export {
	type ButtonLayout,
	InputNumber,
	type InputNumberProps,
	type NumberMode,
} from "./islands/InputNumber.tsx";
export { InputMask, type InputMaskProps, type MaskDefinitions } from "./islands/InputMask.tsx";
export { Password, type PasswordProps } from "./islands/Password.tsx";
export {
	InputGroup,
	InputGroupAddon,
	type InputGroupAddonProps,
	type InputGroupProps,
} from "./components/InputGroup.tsx";
export {
	FloatLabel,
	type FloatLabelProps,
	type FloatLabelVariant,
} from "./components/FloatLabel.tsx";
export { IftaLabel, type IftaLabelProps } from "./components/IftaLabel.tsx";
export {
	IconField,
	type IconFieldProps,
	InputIcon,
	type InputIconProps,
} from "./components/IconField.tsx";
// #endregion

// #region Choice & toggle controls
export {
	Checkbox,
	type CheckboxProps,
	TriStateCheckbox,
	type TriStateCheckboxProps,
} from "./islands/Checkbox.tsx";
export {
	RadioButton,
	type RadioButtonProps,
	RadioGroup,
	type RadioGroupProps,
} from "./islands/RadioButton.tsx";
export { InputSwitch, ToggleSwitch, type ToggleSwitchProps } from "./islands/ToggleSwitch.tsx";
export { ToggleButton, type ToggleButtonProps } from "./islands/ToggleButton.tsx";
export { SelectButton, type SelectButtonProps } from "./islands/SelectButton.tsx";
export { Rating, type RatingProps } from "./islands/Rating.tsx";
// #endregion

// #region Selection controls (listbox family & advanced)
export { Dropdown, Select, type SelectProps } from "./islands/Select.tsx";
export {
	MultiSelect,
	type MultiSelectDisplay,
	type MultiSelectProps,
} from "./islands/MultiSelect.tsx";
export { Listbox, type ListboxProps } from "./islands/Listbox.tsx";
export {
	AutoComplete,
	type AutoCompleteProps,
	type AutoCompleteValue,
	type Suggestion,
} from "./islands/AutoComplete.tsx";
export { Chips, type ChipsProps } from "./islands/Chips.tsx";
export {
	type TreeNode,
	TreeSelect,
	type TreeSelectionMode,
	type TreeSelectProps,
} from "./islands/TreeSelect.tsx";
export {
	type CascadeOption,
	CascadeSelect,
	type CascadeSelectProps,
} from "./islands/CascadeSelect.tsx";
// #endregion

// #region Range & value controls
export { Slider, type SliderProps, type SliderValue } from "./islands/Slider.tsx";
export { Knob, type KnobProps } from "./islands/Knob.tsx";
export {
	SortControl,
	type SortControlProps,
	type SortDirection,
	type SortOption,
} from "./islands/SortControl.tsx";
export { ZoomSlider, type ZoomSliderProps } from "./islands/ZoomSlider.tsx";
// #endregion

// #region Pickers
export {
	DatePicker,
	type DatePickerProps,
	type DateSelectionMode,
	type DateTemplate,
	type DateValue,
} from "./islands/DatePicker.tsx";
export { type ColorFormat, ColorPicker, type ColorPickerProps } from "./islands/ColorPicker.tsx";
export {
	FileUpload,
	type FileUploadContext,
	type FileUploadProps,
	type UploadControls,
	type UploadFile,
	type UploadStatus,
} from "./islands/FileUpload.tsx";
// #endregion

// #region Field wrapper
export {
	FormControl,
	type FormControlProps,
	type FormControlRenderArgs,
} from "./wrappers/FormControl.tsx";
// #endregion
