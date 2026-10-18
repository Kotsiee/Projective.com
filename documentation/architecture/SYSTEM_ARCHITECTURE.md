# System Architecture — Projective

> **Canonical technical source of truth.** This document was renamed from `brain2.md` (formerly at
> `documentation/business/brain2.md`) during the July 2026 restructure. It is the **absolute,
> binding authority** for architecture, the Islands boundary, package taxonomy, database
> conventions, security, caching, and integrations. Its business/product counterpart is
> [`documentation/business/PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) (formerly `brain.md`). If
> the two ever conflict, `PRODUCT_SPEC.md` wins on **business rules**; this file wins on
> **technical/architectural rules**. See the "Restructure Change Log" at the bottom for exactly what
> changed in the move.

## System Directives for Autonomous Agents

> **CRITICAL INSTRUCTION FOR AI AGENTS:** > You are operating within "Projective," a
> high-performance, high-trust collaborative freelancing platform. You are acting as the Lead
> Systems Architect. Read and internalize these absolute rules before executing any commands,
> scaffolding files, or modifying the codebase. Failure to adhere to these rules will break the
> modular monolith architecture.

---

### 1. Database & Schema Mutability (The Additive Rule)

- **Additive Changes Only:** You may add new columns, indexes, or constraints to support new
  features. You **MUST NOT** delete tables, drop columns, or alter existing foreign-key
  relationships (especially around Escrows, Wallets, and Stages) without explicit permission from
  the human developer.
- **The Zod Single Source of Truth (SSOT):** The `@projective/types` workspace is the SSOT. If you
  write a Supabase SQL migration, you MUST simultaneously update the corresponding Zod schema and
  TypeScript interface. The database and the `types` package must never drift.
- **JSONB Contracts:** Before querying or mutating `jsonb` columns, you must define their exact Zod
  shape in `@projective/types` to ensure runtime safety.

### 2. Architecture & The "Islands" Boundary

- **Islands are Dumb:** UI components in `islands/` or mapped via Fresh must **NEVER** import the
  Supabase client or access the database directly. They must use `fetch` to call internal API
  routes.
- **Thin Routes, Fat Services:** Fresh API routes (`routes/api/...`) are only for HTTP parsing, Zod
  validation, and Auth Guarding. All business logic, financial math, and database mutations MUST be
  abstracted into Services.
- **Deno 2.x Workspaces:** Strictly use defined path aliases. The UI layer is consolidated under
  `@projective/ui` with multi-export sub-paths grouped into **seven professional taxonomies**:
  `@projective/ui/layout` · `/navigation` · `/fields` · `/display` · `/feedback` · `/overlay` ·
  `/utils` (declared in `packages/ui/deno.json`; see
  [`documentation/design-system/DESIGN_SYSTEM.md`](../design-system/DESIGN_SYSTEM.md) for the full
  component roster per sub-path). The earlier atoms/charts/data/time/files/system split and the bare
  `@projective/fields` · `charts` · `data` · `time` · `files` · `utils` aliases are **deprecated
  shims** pending consumer migration. App-side use `@server/services`, `@features/*`. Never use
  relative path traversal (`../../../`) across workspace boundaries.

### 3. UI, Styling & Reactivity

- **Pure CSS & BEM Only:** Do not use Tailwind CSS, styled-components, or inline styles. You must
  write Pure CSS using strict **BEM (Block Element Modifier)** conventions.
- **Variable Mapping:** Always utilize the global CSS variables defined in the themes folder (e.g.,
  `var(--primary)`, `var(--field-bg)`). Use `calc()` and `color-mix()` for dynamic states.
- **Theming-engine exception (Material You):** `@material/material-color-utilities` is an
  **approved, explicitly-scoped exception** to the "zero UI-library dependencies" rule. It may be
  used **only** by the theming engine (`packages/ui/system/`) to generate contextual tonal palettes
  from seed colors; it must **never** be imported by an individual component. Its output is written
  into the same `--*` CSS custom properties components already consume, so the component layer stays
  library-agnostic. See
  [`documentation/design-system/DESIGN_SYSTEM.md`](../design-system/DESIGN_SYSTEM.md) §2 for the
  integration path. No other UI/CSS framework (Tailwind, styled-components, MUI, etc.) is permitted.
- **Signal First:** Use `@preact/signals` (`useSignal`, `useComputed`, `effect`) for all local state
  management to bypass the Preact VDOM. Avoid standard React `useState` or `useEffect` unless
  interacting with external, non-reactive DOM libraries (like QuillJS or Canvas).
- **No card-in-card.** Static content is never boxed and boxes never nest. Separate with asymmetric
  spacing, then a **solid** tonal step (`--bg` → `--surface-1` → `--surface-2`), then at most one
  `--hairline`. A region background is never a translucent colour — an alpha wash is unmeasurable,
  compounds when nested, and invites an outline to rescue it
  ([`DESIGN_SYSTEM.md`](../design-system/DESIGN_SYSTEM.md) §B.4, §B.9.7).
- **No tagification.** Containment asserts interactivity. Non-actionable metadata (categories,
  skills, formats, turnarounds, timestamps) renders as inline `--text-secondary` text separated by
  middots — never a pill, chip, tag or badge. Containers are reserved for controls, lifecycle
  statuses, required disclosures and counts (§B.11).
- **`backdrop-filter` is functional, not decorative.** Permitted only on viewport-pinned top bars,
  floating mobile sheets/scrims, and marks sitting on arbitrary photography — and always on a
  `::before` underlay, never on the element, which would re-base every `position: fixed` descendant
  (§B.4.3, §B.10).
- **Hierarchy is four registers, not five weights.** Display / section header / body / meta, each
  moving size, case and tracking together. A heading is never `--fw-bold` or heavier; a changing
  figure is always `tabular-nums` (§A.4).

### 4. Security & Environment Variables

- **Zero Trust Variables:** When writing `.env.example` files, documentation, or placeholder code
  for third-party integrations (Stripe, Google OAuth, Supabase), always use `XXXX-XXXX` as the
  placeholder value. Never hallucinate or insert real API keys.
- **RLS Awareness:** Always assume Row-Level Security (RLS) is active. When writing queries in
  Services, ensure they are executed in the context of the authenticated user's JWT unless executing
  a specific administrative Edge Function.

### 5. Code Quality & Output Format

- **JSDoc Mandatory:** All exported interfaces, classes, services, and complex functions must be
  fully documented using JSDoc.
- **Regions:** Group logical sections of code (Imports, State, Helpers, Lifecycle) using
  `// #region [Name]` and `// #endregion`.
- **No Meta-Comments:** Do not leave comments like `// I fixed this bug` or
  `// Added per user request` in the source code. Keep your reasoning in the chat output.

> **AGENT ACKNOWLEDGEMENT:** If you understand these rules, proceed with your instructions using
> Deno 2.x, Preact, and Supabase best practices.

### 6. SOLID Principles

The system follows SOLID principles to ensure modularity and ease of testing.

- **Interfaces:** We use strict TypeScript interfaces (e.g., `ValueFieldProps<T>`, `BaseFieldProps`)
  to define contracts for component props and state.
- **Single Responsibility:** Logic is separated between **Islands** (UI/Interaction),
  **Controllers** (API Routes), and **Services** (Business/Data logic).
- **Dependency Inversion:** Components depend on generic interfaces (like `DateValue` or
  `SelectOption`) rather than specific implementation details.

---

## Packages

### Fields

This package provides the capabilities of a full input field library like PrimeNG for Angular but
built natively for Deno Fresh 2.x. It utilizes Preact Signals for ultra-fine-grained reactivity and
a specialized interaction hook to track focus, blur, and dirty states across all components.

#### Design Philosophy

- **BEM Styling:** All components follow strict BEM naming conventions.
- **Theme Integration:** Maps directly to `variables.md` HSL logic (e.g., `--field-bg`,
  `--field-border-focus`).
- **Signal First:** Every `value` prop accepts either a raw type or a `Signal<T>`.
- **Composition:** Complex fields are composed of `LabelWrapper`, `MessageWrapper`, and
  `EffectWrapper`.

#### Components

**DatePicker (DateField)** Select a date from a custom-made calendar where a user can click on the
header to view different scopes (days, months, years, decades).

- **Use Cases:** Birthdays (Single), Booking periods (Range), Event scheduling (Multiple).
- **Options:**
  - `variant`: `'popup' | 'inline' | 'input'`.
  - `selectionMode`: `'single' | 'multiple' | 'range'`.
  - `format`: Custom format strings (e.g., `dd/MM/yyyy`).
  - `minDate/maxDate`: Restrict selectable range.
- **Design:**
  - **Text input:** Shows formatted date; includes a calendar icon adornment.
  - **Popup:** Uses `Popover` to display the `Calendar` component.
  - **Header:** Prev/Next arrows with a title that switches scope (Day -> Month -> Year) on click.

**TimePicker (TimeField)** Select a time (Hours, Minutes) from a custom-made clock interface.

- **Use Cases:** Appointment slots, reminder settings.
- **Options:**
  - `selectionMode`: `'single' | 'multiple'`.
  - `variant`: `'popup' | 'inline'`.
- **Design:**
  - **Header:** Digital display with AM/PM toggle. Toggling AM/PM updates the 24-hour underlying
    `DateTime` value.
  - **Body:** A vector clock face. Clicking an hour automatically transitions the view to minutes
    for single-select mode.
  - **Logic:** Uses `getAngleValue` and `getPosition` utils to map pointer coordinates to time
    increments.

**DateTimePicker** A unified picker for selecting the date then the time within the same popup
interface.

- **Use Cases:** Log entries, future-dated posts, flight arrivals.
- **Design:**
  - **Tabs:** A dual-tab header in the popup allows switching between 'Date' and 'Time' views.
  - **Workflow:** Selecting a date automatically flips the tab to the 'Time' view for a streamlined
    UX.

**TextField** Single or multi-line text input with comprehensive state tracking and adornment
support.

- **Use Cases:** Usernames, passwords, descriptions, numeric inputs.
- **Options:**
  - `type`: `'text' | 'password' | 'email' | 'number' | 'tel' | 'url' | 'search'`.
  - `multiline`: Converts the input to a `textarea`.
  - `showCount`: Displays a character counter relative to `maxLength`.
  - `prefix/suffix`: Accepts `JSX.Element` or strings (e.g., currency symbols or action icons).
- **Design:** Uses `AdornmentWrapper` for icons and `EffectWrapper` to render the animated focus
  rings and ripple effects.

**CodeField** _Note: Implementation pending._ Designed for OTP (One-Time Password) or product key
entry.

- **Use Cases:** 2FA verification, license entry.
- **Design:** A series of single-character boxes.
- **Logic:** Focus management automatically shifts to the next index on `input` and returns to the
  previous index on `backspace` (if the current field is empty).

**SliderField** Allows for selection between ranges using single or dual handles.

- **Use Cases:** Price range filters, volume/intensity controls, logarithmic scale data.
- **Options:**
  - `range`: Enable dual handles for `[min, max]` selection.
  - `scale`: `'linear' | 'logarithmic'`.
  - `marks`: Boolean or `SliderMark[]` to show ticks and labels.
  - `snapToMarks`: Forces values to align with defined marks.
  - `vertical`: Switches orientation.
- **Design:** Pure CSS track with `PointerEvent` based handle tracking to ensure smoothness on
  mobile and desktop.

**DropdownField (SelectField / ComboboxField)** A powerful selection component supporting search,
grouping, and virtualization.

- **Use Cases:** Country selection, category tagging, complex relationship mapping.
- **Options:**
  - `multiple`: Enables multi-select with chip rendering.
  - `searchable`: Filters the option list based on input.
  - `groupSelectMode`: `'value'` (selects the group itself) or `'members'` (selects all children).
  - `displayMode`: `'chips-inside' | 'chips-below' | 'count' | 'text'`.
- **Design:** Nested menu rendering with `depth` tracking for multi-level hierarchies. Includes an
  'Action Bar' for 'Select All' functionality in multi-mode.

**SwitchField** _Note: Implementation pending._ A toggle switch for binary states.

- **Use Cases:** Setting toggles, "Remember Me," feature flags.
- **Design:** A pill-shaped track with a sliding thumb. Supports icons inside the thumb or track.
  Uses ARIA `role="switch"`.

**RichTextField** QuillJS enabled editor with support for Markdown and Delta formats.

- **Use Cases:** Content management, formatted descriptions, email drafting.
- **Options:**
  - `outputFormat`: `'delta' | 'html' | 'markdown'`.
  - `toolbar`: `'basic' | 'full' | custom[]`.
  - `onImageUpload`: Intercepts image insertion to handle server-side uploads via a Service.
- **Design:** Integrated with `QuillParser.ts` for real-time conversion between Delta and Markdown.

**TagField (TagInput)** Input field for managing an array of string tags.

- **Use Cases:** SEO keywords, user interests, grouping labels.
- **Design:** Renders tags as removable chips inside the input container.
- **Logic:** Adds tags on `Enter` or `,` keys. Prevents duplicates and handles
  backspace-to-delete-last functionality.

#### Wrappers

**AdornmentWrapper** Provides standard positioning and hit-areas for prefixes and suffixes within
fields. It handles `onClick` events for interactive icons (e.g., password visibility toggles).

**EffectWrapper** The visual engine for the field's interactive states. It manages:

- **Focus Rings:** Animated borders that respond to `interaction.focused`.
- **Ripples:** Material-inspired pointer feedback.
- **Disabled State:** Visual overlays to prevent interaction.

**FileDropWrapper (GlobalFileDrop)** A layout-level wrapper that turns an entire page or a specific
container into a dropzone.

- **Design:** Remains invisible until a `dragenter` event occurs on the `globalThis`, at which point
  it displays a high-contrast overlay.

#### Hooks

**useInteraction** The core state tracker for every field.

- **Functionality:** Returns signals for `focused`, `hovered`, `active`, `dirty`, and `touched`.
- **Usage:** Essential for triggering validation messages and "floating" label animations.

**useFieldState** Manages the synchronization between external props (Signals or raw) and internal
component state.

- **Functionality:** Handles `defaultValue`, manages `error` messages, and provides a `validate()`
  function that checks `required` status and custom Zod schemas.

**useFileProcessor** A non-visual hook for handling file pipelines.

- **Functionality:** Manages a `processingQueue`. It takes a list of `FileProcessor` objects (e.g.,
  Image Resizer, Virus Scanner) and applies them sequentially to files added via `FileDrop`.

**useCurrencyMask** Transforms a numeric signal into a localized currency string.

- **Functionality:** Handles formatting on blur (e.g., `1200` -> `$1,200.00`) and unmasking on focus
  (e.g., `$1,200.00` -> `1200`) to allow easy numerical editing.

---

### Data

This package provides a robust infrastructure for handling lists, grids, tables, and masonry layouts
with infinite scrolling. It separates the concerns of data fetching (`DataSource`), state management
(`DataManager`), and spatial layout (`Virtualizer`).

#### Core Architecture

**DataSource** The abstract contract for data retrieval.

- **RestDataSource**: A concrete implementation for JSON APIs. It includes built-in TTL caching to
  prevent redundant network requests and a `getMeta()` method for pre-fetching total record counts.
- **Normalization**: Automatically transforms raw API shapes into a `NormalizedItem` which tracks UI
  states like `selected` and `isSkeleton` separately from domain data.

**DataManager** The central "brain" of the package. It tracks which ranges of data are currently
loaded and which are "gaps."

- **Gap Detection**: When the virtualizer requests a range (e.g., items 100-150), the manager checks
  its internal cache and only triggers fetches for missing segments.
- **Batching**: Utilizes `@preact/signals` `batch()` to ensure that loading multiple data chunks
  only triggers a single UI render.

**Virtualizer / MasonryVirtualizer** Engines that calculate which items intersect the current
viewport.

- **1D Virtualizer**: Used for Lists, Tables, and Grids. Supports variable row heights via
  `ResizeObserver`.
- **2D MasonryVirtualizer**: Uses a "Shortest Column First" algorithm and binary search to find
  visible items in a non-linear grid.

#### Components

**DataDisplay** A polymorphic entry point that acts as a controller for all display modes.

- **Use Cases**: The primary component for any collection of data.
- **Modes**:
  - `list`: Standard vertical stack.
  - `grid`: Responsive tile layout with native CSS grid rows.
  - `table`: Column-based data with sorting and resizing.
  - `masonry`: Pin-style layout for variable height content.

**Carousel** A high-performance, touch-ready slider.

- **Features**: Supports autoplay, circular looping, and "page" based pagination dots.
- **Design**: Uses a GPU-accelerated `translate3d` track. Only renders items near the viewport
  (buffer zone) to keep the DOM light.
- **Interactions**: Implements a custom Pointer Event engine for unified mouse and touch swiping.

**ChatList** A specialized display optimized for real-time messaging.

- **Features**: Optimistic UI support and scroll anchoring.
- **Scroll Anchoring**: Automatically keeps the user "locked" to the bottom when new messages
  arrive, or preserves their position when loading historical messages from the top.

**Table** A complex data grid for administrative interfaces.

- **Features**: Virtualized rows, sortable columns, and draggable column resizing.
- **Design**: Uses a `Header` and `TableRow` split to allow for fixed header positioning while the
  row body remains virtualized.

#### Hooks

**useVirtual / useMasonryVirtual** Hooks that bind the spatial engines to the DOM.

- **Ref Tracking**: Provides a `measureElement` callback to be attached to items, allowing the
  engine to learn the "real" height of content after it renders.

**useSelection** A headless logic hook for managing single, multi, and range selection
(Shift+Click).

- **Logic**: Automatically handles `Ctrl/Meta` and `Shift` key modifiers to calculate selected key
  sets.

**useScrollAnchoring** A low-level hook that monitors `scrollHeight` changes to prevent visual
jumping during asynchronous data loading.

#### Design Patterns & Preferences

**CSS & BEM**

- All components import local `.css` files (e.g., `carousel.css`, `list.css`).
- Uses BEM naming: `.data-carousel__track--dragging`, `.data-grid__card--selected`.
- Highly dependent on CSS variables for layout: `--carousel-visible-count`, `--gap`.

**Reactivity**

- Prefers `@preact/signals` for performance-critical values like `scrollTop` and `dragOffset` to
  bypass the Preact VDOM where possible.
- Uses `useComputed` to derive responsive widths from `containerWidth` signals.

**SOLID Principles**

- **Interface Driven**: Heavily utilizes TypeScript interfaces for prop definitions
  (`DataDisplayProps`, `CarouselOptions`) and state containers (`Dataset`).
- **Open/Closed**: The `DataSource` can be extended to support GraphQL, Supabase, or LocalStorage
  without changing the UI components.

---

### UI

This package provides a comprehensive set of modular UI components and layout patterns for the
Projective platform. It follows atomic design principles, ensuring that components are reusable,
maintainable, and easily testable.

#### Design Philosophy

- **Pure CSS + BEM:** Strict BEM naming conventions are used for all styling, ensuring
  predictibility and preventing style leaks.
- **Variables First:** Leveraging the CSS variable architecture defined in
  `apps/web/styles/themes/variables/`, components are fully dynamic and themeable.
- **Atomic Design:** Components are built from the bottom up, with higher-level components
  (molocules/organisms) composed of atomic elements.
- **Accessibility (ARIA):** A first-class citizen, ensuring all interactive elements provide correct
  roles, labels, and state information to assistive technology.

#### Overlay & Popup System

Projective implements a robust overlay system for managing modals, drawers, and context-sensitive
popups. To ensure proper layering (z-index) and focus management, all overlays utilize a portal
pattern, rendering content outside the main application flow.

The architecture separates the visual structure (layouts) from the interactive management (islands).

##### Overlays

**Modal** A centered overlay element that blocks user interaction with the main content until
explicitly dismissed.

- **Use Cases:** Confirmation dialogs, forms within popups, displaying critical notifications.
- **Interaction (Modal Island):**
  - Must trap focus inside the dialog when open (using ARIA `dialog` role).
  - Must support closing via the `ESC` key.
  - The backdrop is interactive to dismiss unless a critical action is required
    (`forcedDismissProps`).

**SlideIn (Drawer)** An overlay panel that slides in from the edge of the viewport.

- **Use Cases:** Side navigation menus, secondary content panels, advanced filters.
- **Options:**
  - `position`: `'left' | 'right'`. Controls the origin of the animation and visual attachment.
- **Design:** Follows strict BEM formatting with modifiers for directional positioning
  (`.drawer--left`, `.drawer--right`). Utilizes variables for consistent transition timing
  (`--medium`) and backdrop colors.

**MobilePopup (Bottom Sheet)** A specialized popup designed for mobile contexts that slides up from
the bottom of the screen.

- **Use Cases:** Moblie navigation, action menus, detailed item views. The mobile popup can be
  configured to dynamically replace both Modals and Side Panels when the viewport width is below a
  specific breakpoint (typically 768px).
- **Design (from reference image `image_592d48.png`):**
  - This component mimics the Apple mobile popup design.
  - It features a rounded container and a prominent visual grab handle ("bar") at the top.
  - Its internal structure is organized with distinct headers (e.g., 'X' close button), content
    areas with varied fields (e.g., 'Name' TextField, 'Time' segmented control, 'Send invites'
    Toggle), and action buttons (e.g., 'Cancel', 'OK').
- **Interaction (BottomOverlay Island):**
  - The height is adjustable by dragging the grab handle at the top of the popup.
  - Must utilize Pointer Events to track dragging interaction.
  - Uses Preact Signals to update the dynamic height (CSS `height` property) in real-time.
  - Sliding to a minimum threshold should auto-dismiss the popup with a smooth animation.

##### Overlay Implementation & State

**`OverlayManager` Island:** A centralized island component responsible for managing the stack of
all active overlays on a page. It provides a signal-based API for other components to register their
request to open an overlay.

**`Modal` & `Drawer` & `MobilePopup` Islands:** These islands are the interactive containers for the
respective overlay types. They manage the internal state of the popup, including focus trapping,
keyboard handling, and pointer event tracking for the draggable elements (e.g., MobilePopup handle).

**Layout Components (Web):** Simple, stateless layout components (e.g., `ModalLayout`,
`DrawerLayout`) are used within the islands to provide structure to the content (Header, Body,
Footer) without introducing client-side logic.

#### Core Component Library

The `@projective/ui` package also contains standard atomic components following the same strict
design patterns and variable architecture. The **authoritative design-system spec** — the token
contract, the consolidated `@projective/ui` sub-path taxonomy, the `<DesignSystemProvider>` context
engine, and the per-component state/variant matrices — lives in
[`documentation/design-system/`](../design-system/DESIGN_SYSTEM.md) and the root `CLAUDE.md` "Design
System & Component Architecture" guardrails. Treat those as the source of truth for the component
layer; this section stays a narrative overview, not a duplicate of the matrices.

##### Visual Components

**Icon** A component for rendering vector icons consistently.

- **Use Cases:** Adding visual context to buttons, menus, or notifications.
- **Options:** `variant`, `size`, `spin`, `colour` (mapped to semantic tokens like `--on-surface` or
  `--primary`).

**Button** A highly versatile component for initiating actions.

- **Use Cases:** Submitting forms, closing modals, initiating network requests.
- **Options:**
  - `variant`: `'primary' | 'secondary' | 'danger' | 'ghost' | 'text'`.
  - `effect`: `'ripple' | 'press'`.
- **Styling:** Utilizes CSS `calc()` for dynamic sizing and HSL logic for dynamic colour shifts on
  hover and active states (as defined in `colour.css`).

**Avatar** Renders a visual representation of a user.

- **Use Cases:** Profile sections, message senders, team members.
- **Features:** Auto-generates initial avatars if no image is provided, supports presence indicators
  (online/offline).

##### Data Display Components

**Badge** Renders small status indicators or notification counts.

- **Use Cases:** Displaying status (`primary`, `success`, `danger`, `warning`), showing message
  counts.

#### Layout Components

Atomic layout components are designed using native CSS Grid and Flexbox with variables for
consistent spacing and alignment.

**Grid**

- A pure CSS implementation for generating responsive grids with customizable columns, gaps
  (`--gap`), and alignment options.
- Does not require JavaScript/Islands.

**Flex**

- A flexible layout container providing properties for `direction`, `justify`, `align`, `gap`, and
  responsiveness directly via CSS classes or data attributes.

**Typography** A set of components (`H1-H6`, `P`, `Text`, `Label`, `Subtext`) that standardize font
sizes, families (`--font-sans`), and line heights based on the global variable configurations.

---

### Charts

This package provides high-performance data visualization tools ranging from project management
(Gantt/Kanban) to analytics and freelancer-specific scheduling (Calendar).

#### Visualization Strategy

1. **Hybrid, tiered rendering** (resolved 2026-07-12 — see root `CLAUDE.md` "Resolved Decisions"):
   Preact/HTML for UI controls and headers (accessibility, styling). For the data "stage" the
   renderer escalates by density: **D3.js** for scale/geometry math + **low-density SVG**;
   **Canvas2D** for mid-density; **PIXI.js (WebGL)** for the high-density stage (thousands–100k+
   entities at 60 FPS), fed by the Rust/WASM geometry engine. Selection is automatic on a
   performance metric (entity count + frame budget).
2. **Theme Bridging:** A specialized `theme-bridge.ts` utility synchronizes CSS variables (HSL) from
   the `variables.md` context into Hex values for Canvas rendering, ensuring perfect theme
   consistency.
3. **Signal-Driven:** All interactions (scrolling, zooming, selection) are handled via
   `@preact/signals` to bypass the VDOM for high-frequency updates.

#### Components

**GanttChart** A specialized tool for project timelines and stage management. **Implemented** as
`@projective/ui/gantt` (root `CLAUDE.md` §8 Decision #91) — the `Gantt` island.

- **Design:**
  - **Left List:** HTML-based `GanttTaskList` (`gantt/components/GanttTaskList.tsx`) for rich
    interactions and BEM styling; its rows are in normal flow and virtualized by lane window, and the
    hovered lane grows by the store's `expandPx` so the DOM list and the canvas shift together.
  - **Timeline:** ONE immediate-mode Canvas2D viewport (`gantt/islands/Gantt.tsx` + the pure
    `core/gantt-paint.ts`) supporting infinite horizontal scrolling (a linear day axis two centuries
    each way, virtualized by date offset) and vertical scrolling bounded by the lanes. Every gesture
    is resolved by mapping the pointer into content space and asking `core/layout.ts`'s
    `hitTestItems` what is there. A parallel, visually-hidden accessible layer carries the same
    items as real controls. A WebGL/PIXI tier is the documented escalation above ~1,000 nodes and is
    not built; the theme bridge already returns the numeric hex that tier would take.
  - **Header:** Dynamic "Tiered" header (`GanttHeader`, `core/time-scale.ts` — seven tiers from
    `year/quarter` to `day/hour`) that adapts as you zoom via the footer rig's slider or
    `Ctrl+Wheel`, cursor-anchored, with ticks generated through the calendar's zoned-time matrix so a
    23-hour DST day is 23 hours wide.
- **Features:** Supports milestones (an instant drawn as a diamond, never a box), task dependencies
  (elbowed links via `dependencyPath`), progress tracking (a strip along the bar's base; `null` is
  "no progress channel", a different fact from `0`), drag-to-create on empty lane space,
  drag-to-move, a built-in anchored popover (a bottom-sheet drawer below `--bp-md`), fly mode on a
  middle click, and native pinch-to-zoom.

**AnalyticsDisplay** A polymorphic container for data visualization that allows users to swap
between chart types without reloading data.

- **Components:** `PieChart`, `BarChart`, `LineChart`, `AreaChart`.
- **Logic:** Uses an internal `D3Orchestrator` to calculate paths and scales. The UI renders these
  as either SVG for simple charts or Canvas for datasets exceeding 1,000 points.
- **Interchangeability:** Similar to `DataDisplay`, it accepts a unified dataset and a `view`
  signal.

**Wallet analytics (app-side, Decision #152)** — `/wallet/analytics` is the low-density SVG tier
built in the feature, not a package primitive: `apps/web/features/wallet/core/chart-geometry.ts`
turns the server's series into `d3-scale` / `d3-shape` geometry (a diverging money-in / money-out area
with a net line on ONE y-scale, a dated release axis), drawn in a fixed viewBox the SVG stretches to
its box (`preserveAspectRatio="none"` + `vector-effect: non-scaling-stroke`) so it renders on the
server with no measurement; axis labels, the crosshair and its dots are HTML placed by the same
ratios. Every chart is `aria-hidden` beside a readable twin (a keyboard crosshair with a polite
readout, a visually hidden table, an ordered list). The series is summed in the database per calendar
bucket in the viewer's zone (`finance.ledger_flow`); no figure is ever derived from a coordinate.

**Calendar (Session Planner)** A "Google/Teams Style" calendar optimized for freelancers managing
session-based work.

- **Design:**
  - **Views:** Day, Week (Multi-column), and Month grid.
  - **Session Focus:** Built-in support for "Session" blocks which include client data, location,
    and payment status.
- **Interactions:** Drag-to-create sessions, resize to adjust duration, and "ghosting" for
  overlapping session detection.

**KanbanBoard** A board that balances Trello's visual simplicity with Azure DevOps' functional
power.

- **Design:** Column-based layout with horizontal scrolling and vertical virtualization within
  columns.
- **Power Features:** - **Swimlanes:** Group columns horizontally by priority or assignee.
  - **WIP Limits:** Visual indicators when a column exceeds its Work-In-Progress capacity.
- **Interaction:** Uses standard Pointer Events for drag-and-drop, updating the backend via a
  `KanbanService` on drop.

#### Core Architecture

**GanttStore (Signal Store)** — `gantt/core/gantt-store.ts`, `createGanttStore()`. Manages the
state of one chart instance as `@preact/signals`: `scrollX`/`scrollY`, `pxPerDay` (the time scale),
`rowScale`, the viewport metrics, `hoverId`/`hoverLane`/`expandPx`, `focusId`/`selectedId`, the pan
and fly flags; and the computed `tier`, `visibleRange`, `contentH`. It owns the time-to-pixel map
(`xOf`/`msAtViewX`, `x = (ms − origin) / DAY × pxPerDay`) used by every child, the cursor-anchored
`setZoom`/`zoomBy`, `fitRange`, `centerOn` and `reveal*`. Writes are synchronous, so the geometry is
always correct before any frame is asked for.

**GanttManager (The Orchestrator)** — realised as two hooks rather than a class, because the stage
is Canvas2D and there is no PIXI `Ticker` to coordinate: `useGanttViewport` owns the gesture map
(wheel · pan with momentum · fly mode · the zoom spring · pinch · keyboard) and writes the store;
`useGanttCanvas` paints the scene synchronously in a layout effect and re-paints on resize, DPR,
theme or accent-set change. The canvas twin of the DOM lever physics (`joystickVelocity`) drives fly
mode. Every rAF loop is decoration over geometry the store has already settled.

**ThemeBridge** — `gantt/core/theme-bridge.ts`, `readGanttPalette()`. A critical utility that forces
the browser to evaluate CSS `calc()`, `var()` and `color-mix()` statements, returning resolved
colours (and `cssColorToHex` for a numeric Hex code) for the Canvas engine. It reads a hidden swatch
subtree (`GanttProbe`) through `getComputedStyle` — one swatch per rule, row, link, focus-ring and
per-ACCENT token the data names — and is re-run on any root theme write (`data-theme`,
`data-contrast`, `data-cvd`, `data-font`), so that when `--primary` changes the canvas tasks update
their colour instantly, and the a11y overlays reach the canvas at all.

---

### WASM

The `@projective/wasm` package acts as the performance engine for the Projective platform. By
utilizing Rust compiled to WebAssembly, we achieve near-native execution speeds for
compute-intensive tasks, ensuring the "Projective" experience remains fluid even under heavy data
loads.

#### Core Capabilities & Examples

Beyond basic media handling, WASM is integrated into the following platform-critical workflows:

**1. Media & File Optimization**

- **Image Resizer:** Real-time client-side downscaling of avatars and project attachments before
  Supabase upload to save bandwidth.
- **File Compression:** Transparent GZIP/ZSTD compression for large document uploads within the
  `FileDropWrapper`.
- **Video/Audio Handling:** Frame extraction for video thumbnails and Opus/Vorbis compression for
  audio messages to ensure low-latency playback.

**2. Data & Search Performance**

- **Fuzzy Search Engine:** Powering the `DropdownField` and `DataDisplay` search logic. It enables
  sub-millisecond fuzzy matching across 10,000+ items, which is critical for complex relationship
  mapping.
- **High-Speed Validation:** Offloading massive Zod-like schema validations for large JSON payloads,
  preventing UI "jank" during data ingestion.
- **Diffing Algorithms:** Calculating differences in `RichTextField` Delta objects for version
  history and real-time collaboration.

**3. Graphics & Visualization Support**

- **Geometry Math:** While PIXI.js handles rendering, Rust handles the complex collision detection
  and coordinate mapping for the `GanttTimeline` and `MasonryVirtualizer` when dealing with 100k+
  entities.
- **PDF Generation:** Generating high-fidelity session reports and invoices directly in the browser
  for the **Calendar/Session Planner** using the `printpdf` crate.

**4. Security & Cryptography**

- **Client-Side Hashing:** Implementing Argon2 or PBKDF2 for sensitive data preprocessing.
- **End-to-End Encryption:** Managing AES-GCM encryption for private messages in the `ChatList`
  before they are sent to the database.

#### Architecture & Design Patterns

**Bridge Pattern** The package uses a "Bridge" architecture where Rust handles the raw data buffers
and Deno/TypeScript handles the signal-based state management.

- **Islands Integration:** WASM modules are initialized once at the root layout and shared via a
  `WasmContext` or global signal to avoid redundant loading.
- **Worker Offloading:** Intensive WASM tasks (like video transcoding) are automatically delegated
  to Web Workers to keep the UI thread responsive.

**Naming & Formatting**

- **Rust Side:** Follows standard `snake_case` for functions and `PascalCase` for structs.
- **TS Side:** All WASM-backed functions are exported with an `Async` suffix (e.g.,
  `compressFileAsync`) to reflect the cross-boundary nature of the call.

#### Implementation Notes

- **Memory Management:** We utilize `wasm-bindgen` for efficient memory sharing between the
  JavaScript heap and the Rust linear memory.
- **Error Handling:** Rust `Result` types are mapped to TypeScript `Error` objects with descriptive
  JSDoc headers to ensure the frontend can gracefully handle processing failures.

---

## Backend Services (the Thin-Frontend / Fat-Backend contract)

This concretises §2's "Thin Routes, Fat Services." The system splits **transport** from **business
logic** along a hard line, with a symmetrical service on each side of the network boundary:

- **Thin frontend services** (client) — e.g. `apps/web/features/auth/core/AuthService.ts`. They
  gather inputs, manage local UI state (signals), and make one structured HTTP request per action to
  an internal `/api/*` route, returning a typed result. **No business logic, no DB, no `fetch`
  scattered through islands** — one module owns the endpoint map. Islands stay dumb (§2).
- **Thin routes** (`apps/web/routes/api/**`) — HTTP parse + Zod validation (schemas that will
  consolidate into `@projective/types`) + auth guarding + return-path sanitising only. They call a
  fat service and map its result to a `Response`; they hold **no** business decisions.
- **Fat backend services** — the **`@projective/backend`** package, imported app-side via the
  **`@server/services/*`** alias. They own business logic, encryption, DB transactions, session
  minting, and security policy, and are the **only** layer that touches the Supabase client. They
  are transport-agnostic: every method returns a **`ServiceResult<T>`** (`ok`, suggested HTTP
  `status`, `data`, `message`, field `errors`) that the thin route folds into its response — so a
  route, a cron job, or another service can all reuse the same method.

### `@projective/backend` layout

Follows the standard seven-folder shape; populated as needed:

- `core/env.ts` — the single, lazy, typed reader of the Environment Variable Contract (never throws
  at import; reads only the canonical contract names — the old `.env.development` aliases were
  renamed, Decision #11).
- `core/supabase.ts` — on-demand client provisioning: `getUserClient(jwt)` (RLS-scoped, the default)
  vs `getServiceClient()` (service-role, RLS-bypassing, narrow/audited use only), gated by
  `isSupabaseConfigured()` / `isAuthBackendLive()`.
- `core/access-token.ts` — local access-token verification (`createAccessTokenVerifier`: JWKS or
  HS256 by `alg`, expiry, session claims, a cached JWKS), reached only through
  `AuthBackendService.verifyAccessToken` (Decision #205).
- `services/ServiceResult.ts` — the uniform result envelope + `ok()` / `fail()` builders.
- `services/<domain>/<Name>BackendService.ts` — the fat services. Reference implementations:
  `services/auth/AuthBackendService.ts` (mutating, session-bearing),
  `services/explore/ExploreBackendService.ts` (read-only discovery), and
  `services/newsletter/NewsletterBackendService.ts` (a minimal write — the public opt-in capture).

### Live vs stub, and the guard boundary

Fat services ship **stub-first**: each method returns the safe MVP outcome until the real Supabase /
GoTrue calls are implemented and verified, at which point the environment flips
**`AUTH_BACKEND_LIVE=true`** (default off) to enable the live paths. This keeps a half-wired query
from firing against a real project and keeps the app runnable without a backend. Input **guarding**
that depends on feature-local pure helpers (the DoB age-gate, password-required-unless-OAuth) stays
in the route per §2; it consolidates into `@projective/types` with the Zod schemas when that package
lands. Everything downstream of a validated request belongs to the service.

### Discovery (Explore) services

The Explore feature is the second, **read-only** implementation of the contract: `ExploreService`
(client) → `/api/explore/{search,item,related,suggest}` (thin) → `services/explore/ExploreBackendService.ts`
(fat) → `ServiceResult<T>`. The fat service owns the whole discovery query — filtering, ranking,
merged-section grouping, item lookup, and paged feed expansion — over the LIVE catalogue
(`services/explore/live-catalog.ts`: one `anon` read of the public marketplace, cached 30 s and
shared by every visitor) with `query.ts` and the server-side `skills.ts` resolver, which the app
**never** imports. The `/explore` route and `/view/[id]` call the service directly for SSR first
paint; the `SearchDashboard` island refines client-side via `ExploreService` (filter/sort changes,
infinite-scroll pages, drawer refresh). Cross-boundary shapes — `ExploreItem`, `ExploreParams`,
`ResultGroup`, `SearchPayload`, `HomeFeed`, `SuggestQuery`/`Suggestions` — are the Zod SSOT at
**`@projective/types/explore`**. Typeahead: `GET /api/explore/suggest?q=&scope=` Zod-validates
`SuggestQuerySchema` (422 on failure) and calls `ExploreBackendService.suggest`, which runs the pure
prefix ranker `services/explore/suggest.ts` over the TTL-cached catalogue (top hits per listing type,
matched skills/categories, matched `@handle`s; an empty `q` returns trending — the skills and
categories of the catalogue's trending items (`catalog.trending`, the same signal as Home's rail),
topped up by those most listed in scope over 30 days when the platform is quiet). The client
side is `useSearchSuggest` over the pure `core/suggest-controller.ts` (200ms debounce, one
`AbortController` per request, a request sequence number), rendered by `SearchSuggest`; recent
searches are per-device (`core/search-history.ts`, `LocalKeys.EXPLORE_RECENT_SEARCHES`).
`SearchDashboard.runSearch` aborts and sequence-guards its own refinements and shows a Retry notice
on failure instead of stale results.
**Ranking and personalisation (Decision #178).** The catalogue load also reads the ranking signals —
penalised `search.profiles_index` rows, `search.ranking_weights()` and `search.trending_entities()`
(definers projecting coefficients and an aggregate floored at three people) — and scores every item
once (`ranking.ts`), so the catalogue is assembled best-first and every "recommended" order reads
`catalog.scoreById`. `home({ actor, sim })` composes the SHARED feed (sections, promos, the
Recommended lists, Trending) from that cache, then, for a signed-in viewer, runs a VIEWER-SCOPED pass
(`viewer-signals.ts`): `org.recent_views`, `org.user_bookmarks`, `search.user_affinity` and their
stated interests, read with `getUserClient(jwt)` per request and never cached, composed into the
personal rails by the pure `personalise.ts`; a failed pass is logged and the shared feed served. A view
is recorded by `recordView` → `search.record_view` (a definer, the only writer of `org.recent_views`),
fired in the background by the `/view/[entity]`, `/[handle]/view/[item]` and `/[handle]` routes and,
for the results drawer's in-place open, `POST /api/explore/views`. `/explore` renews a lapsed session
in place and forwards the Dev Context Switcher's `pj.dev.discovery` cookie in development only.
Saves: a card's Star writes through `GET|POST /api/explore/bookmark` (`{ itemId, saved }`, Zod
`BookmarkWriteSchema`) → `services/explore/ExploreBookmarkService.ts`, which resolves the discovery id
against the catalogue (`bookmark-target.ts`) and upserts or deletes the caller's
`org.user_bookmarks` row under their own JWT. Only `SaveableEntity` types carry a Star — a service, a
project, a freelancer/team/business profile — because `org.bookmark_entity_type` cannot name a
product, an article or a buyer. On the client every `CardActions` island reads one page-wide
`core/bookmark-state.ts` store (one `GET` per page, optimistic toggles reverted on refusal). With the
gate off, saves are kept in process memory per user.
**Semantic ranking (Decision #179).** Discovery can rank with Voyage AI `voyage-4` vectors (1024
dimensions, unit length — inner product ranks as cosine) behind one switch, `isEmbeddingsLive(req?)`
(`core/supabase.ts`): not mocked, Supabase configured, `VOYAGE_API_KEY` present, and
`EMBEDDINGS_ENABLED` — or, in development only, the Dev Context Switcher's `pj.dev.embeddings` cookie
(`on` | `off`), which the routes forward only under `IS_DEV` and the gate honours only under
`DENO_ENV=development`. Off, discovery is byte-for-byte the heuristic path and nothing calls Voyage.
On, `ExploreBackendService.search` embeds the query (`services/search/EmbeddingBackendService.ts`:
plain `fetch`, batching, a timeout and a deadline, at most two retries on 5xx / network — and on 429
for documents only — and a two-level query cache keyed by the normalised query: a per-isolate LRU of
512 entries for 6 hours, then Deno KV shared by every isolate for 7 days under
`["cache", "embeddings", EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, "query", sha256Hex(normalised)]`, the
vector stored as its 4,096 `Float32Array` bytes, so a model or width change starts a fresh namespace
and raw search text never reaches a key; a KV read slower than 50 ms, a failed read or a value of the
wrong length is a miss, a KV hit fills the memory layer and bills no tokens, a fresh vector is written
to both (KV fire-and-forget) and a failure to neither; KV is optional — without `--unstable-kv`
`core/kv.ts`'s `openSharedKv` answers `null` and only the in-memory layer runs), asks `search.fn_nearest` for the category's nearest public entities, and the pure
`services/explore/semantic.ts` re-ranks the JS candidate set on the default sort through
`SEMANTIC_BLEND_WEIGHT` and adds up to 12 high-similarity neighbours that pass the same facets; the
`/view` "Similar" rail reads `search.fn_nearest_to_entity` (the item's stored vector, its owner's
items excluded) and keeps the heuristic rail when there is no vector. A search's non-empty resolved
neighbours are kept per isolate for 60 s (an LRU of 256 keyed by normalised query and category,
`services/explore/similarity-cache.ts`), so a later page of the same search never repeats
`search.fn_nearest`. Any Voyage or database failure
falls back to the heuristic for that request with one `[embeddings]` server-log line. A query that,
once normalised, is shorter than 3 characters or has no letter ranks heuristically and never calls
Voyage. A cache-miss query call is guarded twice per isolate. A query 429 is not retried; it is
returned at once with its `Retry-After`. A circuit breaker opens after 3 consecutive transient
failures (anything but a refusal, a malformed answer or a missing key) for 30 s, or for the tripping
429's `Retry-After` when longer (at most 5 minutes), then lets one trial call through: success closes
it, failure re-opens it. A token bucket allows a burst of 20 calls, refilled at 5 a second. An open
breaker or an empty bucket refuses without touching the network (`reason: "circuit_open"` /
`"budget"`), cache hits are still served, and the search ranks heuristically; the breaker logs once
when it opens and once when it closes instead of once per request. The document path keeps retrying
429s and is not guarded by either. Vectors are
written by `deno task embeddings:backfill` and re-embedded after committed listing, profile, project
or workspace writes (`services/search/embedding-sync.ts`): the re-embeds are queued and run as one
sync once 30 s pass with no further write (`REEMBED_SETTLE_MS`), one run per item at a time, so an
autosaving edit session embeds its final text once; a queue lost with its isolate is caught up by the
hash check and the backfill. Both skip an item whose
stored text hash and model still match, and both write through the service-role-only
`search.fn_set_embedding`. Each sync chunk is one Voyage request (planned under `DOCUMENT_BATCH`'s
input and token ceilings), so a refused request never discards vectors already billed. In development
`/explore`, the `/view` pages and every `/api/explore/*` response carry
`x-discovery-ranking: semantic | heuristic`, and the switcher shows the effective state
(`GET /api/explore/ranking`, 404 in production). Home personalisation and user vectors are the
separate ranking-v1 task.

### Discovery telemetry & client observability

Four write paths. They share one transport rule and one table discipline, and add no vendor:
web vitals are measured with the browser's own `PerformanceObserver`, not the `web-vitals`
package.

| Signal | Client | Thin route | Fat service | Table | Gate |
| :-- | :-- | :-- | :-- | :-- | :-- |
| Impressions · card clicks · rail depth (`discovery.*`) | `features/explore/islands/ImpressionTracker.island.tsx` | `POST /api/explore/events` | `services/search/InterestBackendService.ts` | `search.interest_events` | `EXPLORE_BACKEND_LIVE` |
| Discovery queries (`discovery.search`) | (server-side) | `/explore` SSR · `GET /api/explore/search` | `ExploreBackendService.search` → `services/search/query-log.ts` → `search.fn_log_query` | `search.query_logs` | `EXPLORE_BACKEND_LIVE` |
| Production `warn`/`error` logs | `utils/logger.ts` | `POST /api/logs` | `services/logging/LogBackendService.ingest` | `ops.log_entries` | `LOGGING_BACKEND_LIVE` |
| Core Web Vitals (CLS · LCP · INP) | `features/shell/islands/WebVitalsBridge.island.tsx` (mounted in `_app`) | `POST /api/logs/vitals` | `LogBackendService.ingestVitals` | `ops.log_entries` (`level = 'metric'`) | `LOGGING_BACKEND_LIVE` |
| Server 5xx | `routes/_error.tsx` | (none) | `LogBackendService.recordServerError` | `ops.log_entries` (`source = 'server'`) | `LOGGING_BACKEND_LIVE` (the console line is unconditional) |

- **Impression definition.** ONE page-level `IntersectionObserver` over every `[data-item-id]`
  card (a `MutationObserver` picks up cards a refinement adds). A card at least 50% visible for 1 s
  in a visible tab counts once per placement (rail + item) per page view. Rails are the
  `[data-rail-id]` tracks `RailFrame` renders; their depth comes from one capturing `scroll` listener.
  Batches flush at 20 events, on a 10 s heartbeat, on `visibilitychange → hidden` and on `pagehide`.
- **Transport.** `navigator.sendBeacon` with a JSON blob (same-origin, so the session cookie rides
  along and the route resolves the actor with `readActor`). The fallback, when the beacon is refused,
  is `fetch(…, { keepalive: true })` with `x-pj-background: 1`, which the offline guard never blocks.
  The routes answer `202`/`422`/`429`/`503` for logs; nothing reads them.
- **Identity.** Every insert runs under the caller's JWT (`services/telemetry-writer.ts`), so RLS
  pins `user_id` to `auth.uid()` or NULL. A refused attributed write (an expired token, a forged
  decode) is retried once as `anon` with `user_id` NULL rather than losing the rows. No path uses the
  service role.
- **Trust.** The client sends public slugs/handles; `InterestBackendService` resolves them against
  the cached public catalogue and drops any id that is not in it, taking the entity type from the
  catalogue, not the request. A per-process `SlidingWindowLimiter` (30 batches/min per user or
  session) bounds a runaway tab.
- **Development.** The logger and `WebVitalsBridge` never call the server in development (vitals
  go to the Dev Tools log inspector). The `ImpressionTracker` does beacon, and the service
  acknowledges without writing unless `EXPLORE_BACKEND_LIVE` is on.
- **Client render failures.** `ErrorBoundary` (`@projective/ui/feedback`) contains a broken island
  subtree and reports through `logger.error` (and so `/api/logs` in production). The
  `SearchDashboard` island is wrapped in one.
- **`ops` is a PostgREST-exposed schema** for `ops.log_entries` alone (`supabase/config.toml`
  `[api].schemas`; `USAGE` granted, every other `ops` table still revoked). A hosted project must
  add `ops` to **Settings → API → Exposed schemas** too, or every live log insert fails with
  `PGRST106` and is echoed to the console instead.

### Public metrics service (Decision #277)

The public site's live figures — money protected in escrow, stages delivered, the median time from
funding to approval and the platform fee, printed by `/about` and the landing page's live numbers —
come from one fat read: `services/marketing/PublicMetricsService.ts` → `ServiceResult<PublicMetrics>`
(Zod SSOT **`@projective/types/marketing`**), served raw to SSR and as `GET /api/public/metrics`
(thin, `defineReadRoute`, `public-metadata`). It calls ONE aggregate, `finance.public_metrics()`
(SECURITY DEFINER, service role only), which returns counts, per-currency sums and a median and
applies the publication threshold itself — `security.platform_params.public_metrics_min_n`, 10 when
the row is absent (the service logs the fallback) — each figure by its own count; the per-currency
parts reach only the service role; the service holds every figure to the same threshold again.
Escrow in several currencies is converted into the base currency through `FxService` (read-time,
finance-model.md §11) and withheld if any currency has no rate or a code is malformed; the published
total is floored to two significant figures, so two hourly reads never difference to one escrow.
Cached one hour in its own `ArcCache` (`core/cache.ts`) under the anonymous tenant — the answer is
the same for everyone; concurrent misses share one read; a failure is held 30 s, never cached for the
hour. Behind
**`FINANCE_BACKEND_LIVE`**; off, the same fold runs over an aggregate frozen from the seeded database
(`public-metrics-fixtures.ts`).

### Newsletter services

The public footer's "stay updated" capture is the third implementation of the contract, and the
smallest write: `NewsletterService` (client) → `POST /api/newsletter/subscribe` (thin) →
`services/newsletter/NewsletterBackendService.ts` (fat) → `ServiceResult<T>`. The subscribe shape is
the Zod SSOT at **`@projective/types/community`** (`NewsletterSubscribeSchema`; the old
`@projective/types/newsletter` path re-exports it), validated in three places without drift: the
client service (before the round-trip), the thin route (the request body), and the fat service
(defence in depth). A submission carries an optional **topic** (`general` by default, `changelog`
for the changelog's capture). Behind **`NEWSLETTER_BACKEND_LIVE`** (default off, gated by
`isNewsletterBackendLive()`) the service calls `community.subscribe_newsletter` with the service
role — the table's one writer, which adds a topic idempotently and, for an unsubscribed address,
only records a pending re-subscribe: the opt-out stays on record and in force until the confirm link
applies it (Decision #274); off, it answers the same plan and stores nothing. An address is at most
254 characters at every layer, and a 429 carries `details.retryAt` and `Retry-After`. The
email-provider sync and the confirmation mail are still to come. The `NewsletterForm` island (with
optional `topic` / `source` props) is the only client touchpoint — it `fetch`es the route and never
reaches the service.

### Editorial & community services

Two schemas carry the public surfaces (Decision #274). **`editorial`** holds platform-authored
content — the help centre, the changelog, Projective's articles — authored as Zod-validated
TypeScript in `services/editorial/content/<surface>.ts` and emitted by
`deno task db:editorial:generate` into one category-5 migration per surface, so it exists in every
environment. `services/editorial/editorial-source.ts` is the one shared module: the
**`EDITORIAL_BACKEND_LIVE`** gate (`isEditorialBackendLive()`), `defineEditorialTable` (a table's
row schema, natural key and both mapping directions, `core/row-mapper.ts`) and `readEditorialTable`,
which reads the table through the anon client when live and otherwise pushes the same authored
records through the same row parse and mapping — so a fixture cannot drift from the database. A
table's `visible` predicate (drafts, future-dated releases, retractions) is applied to the mapped
records on both roads, and its SELECT policy states the same rule; the generator seeds every record
and never prunes, so content is retracted by hiding it, never by deleting its record.
**`community`** holds what people do: the newsletter, helpfulness votes and the feedback board.
`services/community/community-source.ts` is its shared module: the **`COMMUNITY_BACKEND_LIVE`**
gate, `defineCommunityTable`, `readCommunityTable` (the caller's client live, declared fixtures
otherwise, both through one row parse) and `communityRpc` for the schema's definer doors. Surface
services are built on these by their own work orders; the newsletter keeps its own gate.
The feedback board's `services/community/FeedbackBackendService.ts` (Decision #272) is the first:
it reads as the caller (RLS decides who sees an idea under review), writes only through
the board's definer doors, and with the gate off runs the same code over a per-process fixture
store (`feedback-store.ts`) that mirrors every door — the seed's own sixteen ideas.

**The help centre (P2)** is the first surface on both. `services/editorial/HelpBackendService.ts`
reads `editorial.help_categories` / `help_articles` through `readEditorialTable`, organises them
into a library (`help-library.ts`: topics, reading order, neighbours, related reads, role columns,
the FAQ) and builds an in-memory search index (`help-search.ts`: folded terms, title > headings >
summary > category > body weighting, prefix matching and a one- or two-edit typo fallback, AND with
an OR fallback, sentence snippets and `[start, end)` highlight runs — pure, no search dependency),
cached five minutes and never cached on failure. `services/community/HelpFeedbackBackendService.ts`
writes "Was this helpful?" through the definer door `community.submit_help_feedback` as the caller
(their JWT when signed in, anon otherwise), behind per-process `SlidingWindowLimiter`s (10 per signed-in voter
per 10 minutes, 20 per guest address a minute) in front of the door's durable limits; with `COMMUNITY_BACKEND_LIVE` off it validates
and answers without storing. Routes: `/help/[...path]`, `GET /api/help/search`,
`POST /api/help/feedback` (ROUTING.md).

**Changelog (P5, Decision #278).** `services/editorial/ChangelogBackendService.ts` reads
`editorial.changelog_releases` through `readEditorialTable` (the table's `visible` predicate has
already dropped withdrawn and future-dated releases on either road) and orders, filters and pages
the whole table in TypeScript with the pure `changelog-feed.ts` (newest first by day then semver
precedence; a category filter matching ANY selected category; ten to a page; a release's
neighbours): `releases()`, `feed({ categories, page })` (404 past the last page) and
`release(version)` (one 404 for unknown, withdrawn or future). The routes `/changelog`,
`/changelog/[version]` and `/changelog/rss.xml` are thin controllers in `features/changelog/routes/`;
the RSS document is the pure `features/changelog/core/rss.ts`, every URL absolute on `siteOrigin`.

### Messaging services

The global inbox (`/messages`) is a READ-heavy implementation of the contract: `MessagingService`
(client) → `/api/messaging/{conversations,conversation,messages,contacts,settings}` (thin) →
`services/messaging/MessagingBackendService.ts` (fat) → `ServiceResult<T>`. Cross-boundary shapes —
the conversation list / detail / contact-picker / settings projections — are the Zod SSOT at
**`@projective/types/messaging`**; message BODIES reuse `@projective/types/projects`'
`MessagePage`/`ChatMessage` because a project channel and the inbox are one thread, **unified by
`chatId`** (`PRODUCT_SPEC.md` §Unified Messaging) — so the fixtures derive the `dm-{handle}`
conversation ids to match the project DM ids. Stub-first behind **`MESSAGING_BACKEND_LIVE`**
(default off), gated by `isMessagingBackendLive()`; the live path (RLS-scoped `messages.*` tables)
slots in behind that guard with zero shape churn. Full feature detail (the floating pop-out chat
with navigation memory, the role-specific advanced filters, the profile quick-message popover, the
`messagingRole` dev-context axis) is logged in the root `CLAUDE.md` §8 Decision #49.

**Conversation writes and the ranked picker (Decision #102).** The inbox's two writes — starting a
conversation (`POST /api/messaging/conversations`, one pick → the pair's DM, several or a named
pick → a group, with an optional opening message posted in the same act) and adding members
(`POST /api/messaging/conversations/members`, a DM with a third person becomes a group) — go
through `ContactsService` (client) → the thin routes → `MessagingBackendService.{createConversation,
addMembers}` (fat). On the live path every write is a `SECURITY DEFINER` RPC
(`comms.get_or_create_dm_thread` · `comms.create_group_thread` · `comms.add_dm_thread_members`):
`comms.dm_threads`/`dm_participants` carry NO client `INSERT` policy on purpose, so the membership
decision is made in one place and the thread's uuid is the id every `/messages` route addresses. On
the stub path a per-process **conversation store** (`services/messaging/conversation-store.ts`, the
sibling of the message write store) holds created rows, which the fixture summary lookup consults
FIRST so a created group resolves through detail, messages and send exactly as a live one. The
people picker (`GET /api/messaging/suggestions`) is **ranked by relationship, then recency** — the
rule lives ONCE in the SSOT (`@projective/types/messaging` `deriveContactRank`) and both branches
feed it EVIDENCE: the live path from `org.*_members`, `org.profile_follows` (both directions),
`projects.projects`/`project_participants` and the viewer's threads; the stub from the same casts
the rest of the app renders. The same ranked read (`useContactSearch`) feeds the messaging picker
(`ContactList`) and the three people pieces in `apps/web/features/share/` — `ShareLinkBar`,
`UserSearchPopover` (a debounced combobox over the read) and `QuickAddRail` — which the
platform-wide **share modal** (one `ShareHost` island per shell, driven by the `share-request`
bridge) and the Members tab's **Invite modal** (`InviteShareModal`) both compose (Decision #145), so
"send this to somebody", "invite somebody" and "start a conversation" cannot disagree about who
comes first.

**Sending a message, and the profile-side Hire (Decision #103).** The inbox's send is
`SendConversationMessageSchema` (`@projective/types/messaging/send.ts`, one field apart from the
project send: a conversation is addressed by its own id) → `POST /api/messaging/messages/send` (thin)
→ `MessagingBackendService.sendMessage` (fat) → `{ message: ChatMessage }`. The shared `ChatComposer`
posts here in its `conversation` scope and announces the SERVER's row on `MESSAGE_SENT_EVENT`, so the
profile's floating messenger, the pop-out chat and `/messages/[conversationId]` all send through one
door and every feed on the page appends what was actually stored. Live, the thread is resolved (a
`comms.dm_threads` uuid verbatim; a unified `dm-{handle}` through `org.users_public` +
`comms.get_or_create_dm_thread`, so a first message CREATES the conversation in the same act) and the
row is inserted under the new `send_dm_messages_if_participant` policy (`00002012`, `sender_user_id`
pinned to `auth.uid()`); on the stub path a per-process **message write store**
(`services/messaging/write-store.ts`) folds sent rows onto the latest page, and a first message to a
synthesised `dm-{handle}` is remembered in the conversation store so it joins the inbox list. The
global messenger itself is the existing `ChatPopoutHost` (sessionStorage-persisted), now mounted by
EVERY authenticated layout and docked into the bottom-end corner for a profile-started conversation.
The profile-side **Hire** is a projects read+write: `GET /api/projects/hire?projectId=` composes
`HireBrief` (`@projective/types/projects/hire.ts`, built by the pure `buildHireBrief` from the owner's
`ProjectSetup` + the `MemberRosterPage`, with the pricing model DERIVED from the engagement's shape:
pipeline → per-ticket per stage, multi-stage one-off → per stage, single-stage one-off → one task
price) and `POST /api/projects/hire` validates a `HireInvitation` against that brief through the SAME
`hireInvitationRefusal` the modal gates its Send with. Persistence is the per-process store on both
sides of the gate, deliberately: `projects.project_invitations` addresses an invitee by email (which
the inviter cannot resolve for another user under RLS) and carries neither the compensation nor the
message, so a live insert would record a success the row does not describe — flagged for a schema
decision rather than papered over.

**Formatting and replies.** Both send schemas — `SendProjectMessageSchema`
(`@projective/types/projects/messages.ts`) and `SendConversationMessageSchema` — carry, besides
`text` · `attachmentIds` · `audio`, two optional fields that default to "plain, not a reply":
`delta`, the body's inline formatting (Bold · Italic · Underline · Strikethrough) as a normalised
Quill Delta (`MessageDeltaSchema`, `@projective/types/projects/message-rich.ts`), and `replyToId`, the
message this one answers. A Delta must spell `text` exactly (`sendDeltaAgrees`, a schema refine) —
it is never a second source of words. Both tables store the plain body in `body` (which search,
previews and the PII mask keep reading) and the Delta in `body_delta`, with the reply as a
self-referencing `reply_to_id` (`00000016`); `ChatMessage` gains `delta` and `replyTo` (a
`MessageReply` quote: sender, `isOwn`, a one-line excerpt, a `media` label, `available`). Three rules
hold on every path: (1) a READ shows a Delta only when it spells the body being shown
(`messageDeltaFor`), so a clamped or PII-masked body renders plain — the mask triggers also null
`body_delta` when they rewrite; (2) a reply's original must sit in the reply's own channel / thread —
refused as `422` on `replyToId` with "That message can't be replied to here." by the fat services'
pre-check (`services/projects/message-replies.ts#replyRefusal`) and, as the backstop, by
`comms.tg_guard_message_reply` / `tg_guard_dm_message_reply`, whose raise `refusalFrom` maps onto the
same refusal; (3) a deleted or unreadable original renders as an `available: false` quote rather
than disappearing. The live writes map their echo from the STORED row, so the sender sees the masked
body exactly as everyone else will. On the stub path the original is looked up in the conversation's
whole fixture history plus the viewer's own sent overlay, under the same refusal.

**Inbox folders, hiring requests and the context panel (Decision #128).** A conversation's folder
(`primary` · `requests` · `archived`) is the VIEWER's: it lives on `comms.dm_participants`, and every
read projects it as `ConversationSummary.folder` (with `archived` derived from it). The lane
partitions the loaded set by folder client-side; a move is optimistic (`folder-moves.ts`) and
confirmed by `MessagingBackendService.setFolder` → `comms.set_dm_inbox_folder`. A hiring request's
message — an invitation's intro, an application's cover note — is posted by the PROJECTS service
after the request is recorded, through `MessagingBackendService.requestMessage` →
`comms.send_request_message` (live) or the stub `sendMessage` (fixtures); the folder routing and the
reply promotion are database rules (`comms.fn_promote_thread_on_reply`), mirrored for the stub by
`folderAfterSend` / `requestRouting` and a per-process folder store. The context panel reads
`MessagingBackendService.context` → `projects.get_engagement_context`, and `context-model.ts`
DERIVES the actions server-side, so a control renders only when its write would be accepted. The
stub corpus is frozen at one instant (`CORPUS_NOW`), and everything the stub dates — labels, request
expiry, the protected-phase check — reads that clock rather than `Date.now()`. A live `dm-{handle}`
with no thread yet resolves to a VIRTUAL conversation (an empty page), never a minted thread.

**Links in messages (Decision #128).** `POST /api/links/preview` → `LinkPreviewBackendService`: an
INTERNAL link (the serving origin, `APP_URL`, or a canonical product host) becomes a card read
through the service that owns it, under the reader's identity (`ProfileBackendService`,
`ProjectBackendService`, `ExploreBackendService`); an EXTERNAL one gets the link-scan verdict and,
only when `safe`, the page's title, description and re-hosted icon. Signed-in readers only, 30 per
minute, cards cached 60 s per reader. The browser batches every bubble's links into one request
(`features/links/core/link-previews.ts`) and routes any external link whose verdict is not `safe`
— including one not yet answered — through `/exit` (`exitHref`), whose verdict comes from
`LinkPreviewBackendService.exitCheck`: a signed-in visit scans (rate-limited), a guest only ever
sees a remembered verdict plus the URL's own shape, so the page is never an anonymous fetch proxy.

### Contact & financial leakage prevention (Decision #147)

The protected-phase contact filter (`PRODUCT_SPEC.md` §Messaging 1 "Platform Integrity" and §3 "The
Handover State") is a three-tier, edge-to-database pipeline. **Tier 2 is the authority**; Tiers 1
and 3 may add detection but never relax it, and none of the three runs once
`projects.handover_unlocked_at` is set.

```text
send ─▶ Tier 1  in-process pre-filter (fat service, sync, <2 ms) ──refuse──▶ 422 to the composer
          │ pass
          ▼
        Tier 2  BEFORE INSERT trigger → comms.mask_pii (authoritative) ──▶ row stored, pii_masked
          │ after commit, candidates only
          ▼
        Tier 3  self-hosted Presidio (async worker) ──▶ review queue → Consequences ladder
```

**Tier 1 — in-process pre-filter (planned).** Runs inside the fat send services
(`MessagingBackendService.sendMessage`, the projects message send, `comms.send_request_message`'s
callers) before the insert, in the same Deno process — no network hop, no per-call cost. Pipeline:
(1) NFKC-normalise and fold Unicode confusables/homoglyphs (Cyrillic `а` → `a`, full-width digits,
zero-width joiners stripped) so an obfuscated address is matched in its plain form; (2) extract URLs
and bare domains with `linkify-it`, resolve the registrable domain with `tldts`, and match it against
the payment / messaging host list `comms.mask_pii` carries; (3) run the four Tier 2 categories over
the normalised text; (4) Luhn-check every 13–19 digit run so a payment card is refused while a long
numeric reference is not. A hit is refused as `422` naming the category, shown inline by the
composer. Hot paths may move into the `WASM` package (§Packages → WASM) when profiling warrants;
the contract is unchanged. **Today Tier 1 is only the composer's advisory warning:**
`packages/types/comms/pii.ts` (`maskPii` / `containsPii`), pinned to the SQL patterns by
`pii.contract.test.ts`. Any category Tier 1 adds (card numbers, confusable-folded matches) must land
in `comms.mask_pii` in the same change — otherwise a direct write stores what the edge refuses.

**Tier 2 — database enforcement (shipped).** `trg_mask_message_pii` (`comms.project_messages`) and
`trg_dm_messages_mask_pii` (`comms.dm_messages`), both `BEFORE INSERT`, `SECURITY DEFINER`
(`00001300` / `00001840`). Each resolves the protected engagement (`projects.is_protected_phase` for
a channel's project; `comms.fn_dm_protected_project` for a DM), runs the `IMMUTABLE`
`comms.mask_pii(text)`, and on any hit rewrites `body`, nulls `body_delta`, and sets `pii_masked` /
`pii_categories`. It fires on every insert path, so a client that skips the services is still
masked. **Known gap:** both triggers are `INSERT`-only, and `comms.project_messages` carries the
`edit_own_messages` `UPDATE` policy with no column restriction (`GRANT ALL` on `comms` to
`authenticated`) — a sender can edit a stored body, or `pii_masked`, after the mask ran
(Decision #147 flag (c)). `comms.dm_messages` has no `UPDATE` policy and is not exposed.

**Tier 3 — asynchronous deep NLP (planned).** A dedicated, Dockerised **Microsoft Presidio**
analyzer (spaCy NER + Presidio pattern/context recognisers, plus custom recognisers for spelled-out
numerals, split handles and "at"/"dot" addresses) on a 2 GB RAM VPS container (~$10–15/month). It is
fed **after commit** by a background worker draining a queue of candidate messages — protected-phase
rows Tier 2 did not mask, plus rows Tier 1/2 flagged as near-misses — so message latency never
depends on it. It returns entity spans and scores only; it never writes `comms.*_messages`. Scores
above threshold become review-queue entries for the **Consequences** ladder (`PRODUCT_SPEC.md`
§Messaging 1). The analyzer is reachable only from the worker on a private network, keeps no
payload after scoring, and is not a sub-processor (message bodies never leave Projective's own
infrastructure). The queue table, the review-queue table, the worker and the analyzer's environment
key are not yet designed; each lands with its migration, Zod schema, `documentation/database/*` entry
and Environment Variable Contract line in one change (§1 Additive Rule, Zod SSOT).

**Why self-hosted, zero-SaaS.** Enterprise trust & safety APIs (Sift, Hive Moderation and peers) were
rejected: per-message pricing scales with the busiest surface on the platform, every protected-phase
message would be shipped to a third-party processor, and their synchronous review would sit on the
send path. The chosen split puts the cheap, deterministic checks where they cost nothing (in-process
Tier 1), the guarantee where it cannot be bypassed (Postgres Tier 2), and the expensive judgement
where latency does not matter (self-hosted Tier 3), for one small container's compute.

**Public surfaces (planned).** The permanent prohibition on contact and payment details in public copy
(`PRODUCT_SPEC.md` §Messaging 1.B) reuses the Tier 1 detector at create/update time in each owning
write door — `org.save_profile` (`org.users_public.headline` / `bio`), the catalogue write services
(`catalogue.products`, `catalogue.listings`, `marketplace.service_blueprints`) and the projects
setup write (`projects.projects.title` / `description`) — and **refuses** (`422`, field-named) rather
than masks. It ignores `handover_unlocked_at`. No public-copy check exists yet.

### Content moderation — the Two-Zone model (Decision #148)

`PRODUCT_SPEC.md` §Messaging 1.C. **Public Glass Front** surfaces are screened proactively before
publication; the **Private Collaborative Workspace** is moderated reactively, from user reports.
Everything below is **planned** — no classifier, report table or report route exists yet.

| Zone | Buckets | Tables | Automated explicit-content screening |
| :--- | :------ | :----- | :----------------------------------- |
| Public | `avatars` · `showcase` · `catalogue` · `public_assets` | `org.users_public` (`headline`, `bio`, avatar/banner), `catalogue.*`, `marketplace.service_blueprints`, published `projects.projects` copy | **Required** before publication |
| Private | `project` · `messages` · `personal` · `workspace` | `comms.project_messages`, `comms.dm_messages`, `projects.stage_submissions`, `files.items` in private buckets | **None** (the Decision #147 contact filter still runs) |

**The publication gate (`@server/services/media`).** Quarantine admits every upload into a private
library (`personal` / `workspace`, §Storage Lifecycle); a public object only ever comes from a later
**publish** step — today `MediaBackendService`'s rendition cut into `avatars` / `showcase`, and the
catalogue media writes once they move behind the pipeline. The gate runs there, on the decoded
pixels, **before** the WebP tiers are cut:

1. Decode the library original (the existing Worker step) and send the decoded still — for a video,
   its poster plus sampled frames — to the classifier.
2. **Clean** → cut tiers, write the public object, attach (`org.set_profile_avatar`,
   `org.save_showcase`, the catalogue write) as today.
3. **Flagged** → no public object is written and nothing is attached; the publish answers `422`
   with the category, and the owner receives a correction notice (a `comms.fn_notify` event; the type
   key lands in the catalog with the feature). The library original keeps `status = 'uploaded'` —
   it is the owner's private file and stays usable privately. `quarantined` remains reserved for
   hostile bytes found by the sniff.
4. **Classifier unavailable** → fail closed: the publish answers `503` and is retryable; nothing is
   published unscreened.

Public text (`headline`, `bio`, listing and service copy, project briefs) is screened at the same
write doors as the Decision #147 public-copy leakage check, for hate speech and slurs.

**The classifier stack — self-hosted first.**

- **Primary:** a self-hosted CPU container exposing two analyzers behind one internal endpoint —
  **NudeNet** (image nudity/exposure detection) and **Microsoft Presidio**, the Decision #147 Tier 3
  service, whose Image Redactor (OCR) catches contact and payment details written into an image.
  CPU inference only, no GPU, reachable only from the media service on a private network, no payload
  retained after scoring.
- **Fallback (optional, off by default):** a hosted moderation API (OpenAI's moderation endpoint or
  Sightengine) for categories NudeNet does not cover (graphic violence, hate symbols) or when the
  container is down. Enabling it makes the provider a sub-processor of **public-bound** images only;
  private content is never sent to it.
- Thresholds per category are tunable configuration, not code; every verdict (category scores,
  model version, decision) is recorded on the publish attempt so a disputed refusal can be audited.

**The reactive reporting workflow (private and public zones alike).**

1. **File** — `POST /api/reports` (thin: Zod + auth) → a reports fat service. The client sends only
   the subject (`subject_type`, `subject_id`) and a `reason`; the service confirms the reporter can
   read the subject **under their own JWT** (a report is never a way to read something), then builds
   the **evidence snapshot server-side** from the stored row — body, author, room/thread, timestamps,
   and for a file its id, `content_hash` and a service-held copy — never from client-supplied text.
2. **Store** — one `ops.reports` row, `status = 'pending'`. The snapshot is immutable: no `UPDATE`
   path touches it, and deleting or editing the original afterwards leaves it intact.
3. **Review** — an `ops.admin_users` reviewer resolves it `dismissed` or `actioned` with
   `resolution_notes`, through a `SECURITY DEFINER` door; the reporter's identity is never projected
   to the reported party.
4. **Penalise** — `actioned` writes a `security.penalties` row (`subject_type` · `subject_id` of the
   author, `severity`, `source_id` = the report) and calls `org.fn_recompute_standing`, whose
   `penalty` component subtracts active penalty severity; a lower score can demote the rung
   (`org.standing_events` records `demoted`). The outcome is a mandatory notification.

**Proposed `ops.reports` shape** — not migrated; it lands with its migration (`00000013_tables_ops`,
edited in place), RLS policies, Zod schema and `documentation/database/ops/*` in one change:

| Column | Type | Notes |
| :----- | :--- | :---- |
| `id` | uuid | PK. |
| `reporter_user_id` | uuid | FK → `auth.users`. Never projected to the reported party. |
| `reported_subject_type` | text | CHECK: `project_message` · `dm_message` · `stage_submission` · `file` · `profile` · `listing` · `service` · `project`. |
| `reported_subject_id` | uuid | The subject row; deliberately not an FK (subjects span schemas and must outlive deletion). |
| `reason` | text | CHECK against a closed reason vocabulary (Zod SSOT). |
| `evidence_snapshot` | jsonb | Server-built at filing; immutable; Zod-typed per subject type (§1 JSONB Contracts). |
| `status` | text | CHECK `pending` · `dismissed` · `actioned`; `DEFAULT 'pending'`. |
| `resolution_notes` | text | Reviewer's notes; required when leaving `pending`. |
| `resolved_by` / `resolved_at` | uuid / timestamptz | Set together on resolution. |
| `created_at` | timestamptz | `DEFAULT now()`. |

**Why this split.** Proactive screening is spent only where content meets strangers — a small,
bounded volume of profile, showcase and listing media — so a CPU container covers it; the private
zone, where volume is unbounded and false positives would block legitimate creative work, costs
nothing until a person asks for review.

### Catalogue services (the first WRITE surface)

The seller-side Catalogue (`/catalogue` + the per-item workspace `/catalogue/[id]`) is the **first
write-oriented** implementation of the contract, through the same thin/fat split: `CatalogueService`
(client) → `/api/catalogue/{list,item,create,update,status,media,media/reorder,media/save,batch,duplicate,skills}`
(thin: parse + Zod + auth guard, and the age gate on a publish) →
`services/catalogue/CatalogueBackendService.ts` (fat) → `ServiceResult<T>`. It is **live only**, as
the signed-in seller: reads under the catalogue policies (`live-catalogue.ts`), writes through the
`catalogue.*` doors (`live-catalogue-writes.ts`) — `create_listing`, `save_listing` (with
`expected_updated_at`: a stale save is a `409` whose `details.current` is the listing's current
`updatedAt`), `apply_listing_media`, `set_listing_status`, `set_listings_status` (one outcome per
listing) and `duplicate_listing`. `update` reads its body as JSON whatever its content type, because
the workspace flushes unsaved edits with `navigator.sendBeacon` (a `text/plain` Blob) when the page
is hidden. `media/save` keeps the showcase's existing items by file (emptying a slot or editing its
alt text, no re-cut) through the same `apply_listing_media` door; `skills` answers `org.skills`
labels for a typed prefix. The SEO tags typeahead is `GET /api/search/suggest-tags?q=`, a thin
route over `ExploreBackendService.suggest` that offers the skills and categories it matched as tags. A guest gets a `401` and an outage a `503`, never a sample
catalogue. Cross-boundary shapes are the Zod SSOT at **`@projective/types/catalogue`**; pricing is
**not forked** (`ServiceType`, `EntityPricing` and the discovery `ticketPrice`/`sessionPrice`
fields are reused). A listing's `offer` is mapped to and from its blueprint or product columns in
one module (`offer-columns.ts`), so a field cannot be written under one name and read under another.

**One card mapping (Decision #217, plan §4.6).** The discovery card a listing renders as is built by
the pure `listingCardItem(source)` (`@projective/types/explore/listing-card.ts`), which both the
explore assembler (`live-catalog.ts#assemble`, from rows) and the workspace's live card (from the
edited `ListingDetail`, which satisfies `ListingCardSource` as it is) call. A contract test holds
the two row mappings to the same item for every fixture listing
(`services/catalogue/card-fidelity.test.ts`). The showcase rows are mapped to slots once, too
(`services/catalogue/listing-media.ts`): a slot is drawn from its public 16:10 rendition.

**Showcase renditions.** The profile showcase and the listing showcase share one cut,
`services/media/showcase-rendition.ts#cutShowcaseRendition`: the caller's library asset is re-read
under their session, slot 1 takes a still only, and the pipeline (service role) writes a public
rendition owned by the surface's owner. The surface's own door then decides, under the caller's
session, whether it may be placed (`org.save_showcase`, `catalogue.apply_listing_media`); a refusal
retires the rendition.

**The item workspace store.** `/catalogue/[id]`'s islands (lane outline, header band, canvas,
footer rig, panel) share `features/catalogue/core/workspace-store.ts`, the one network owner for
the listing. It autosaves 800 ms after the last edit with a **section-scoped** patch (every field of
each Edit section that changed) against `expectedUpdatedAt`. A `409` is first compared with the
server's copy: if every patch field still holds what this tab saved or last beaconed, the bump was
its own (a showcase write or a landed beacon moves `updatedAt` too) and the save is retried
silently; otherwise the seller chooses Reload theirs or Overwrite with mine. The rules are pure, in
`workspace-model.ts`.

**The owner's buyer simulation.** `CatalogueBackendService.previewView` composes the same
`EntityView` `/view/[id]` renders, through the same assembler, from `resolveListing(slug, { as:
"owner", actor })` (`services/explore/listing-source.ts`): the listing read with the seller's own
token, draft and paused included. A listing that is not the caller's resolves exactly as a missing
one (`404`), so the answer never reveals that it exists.

**Analytics and Clients (plan §4.7, §9.2).** Two read-only fat services sit beside it, behind
`GET /api/catalogue/analytics` and `GET /api/catalogue/clients` · `/api/catalogue/clients/<handle>`
(thin: auth guard, then `?listing=` (a `svc-`/`prd-` slug, the workspace tab) or `?scope=`
(`ConsoleScope`, the console view), `?period=` and the dev-axis `?sim=`, each refused with a `422`
keyed by parameter; the handle is a `ClientKey` with its `@` stripped). Both resolve a scope to the
seller's listings in one place (`services/catalogue/listing-scope.ts`; a collection scope reads
`catalogue.collection_listings`), and both keep their arithmetic in a pure module the tests hold
without a database:

- `CatalogueAnalyticsBackendService.overview` reads `analytics.daily_rollups` under the seller's
  JWT through the INVOKER `catalogue.get_listing_rollups` (`analytics` is not an exposed schema;
  the table's own policy still decides), paged past `max_rows`, and assembles tiles (gross, orders, conversion, churn, Standing
  impact), the revenue series (daily; weekly for `90d` / `12m`), the funnel, the booking heatmap
  (only when the scope sells sessions, in the seller's timezone), keywords and the console's top
  listings (`analytics-model.ts`). A rate is `null` below 20 in its denominator and a keyword is
  listed only from 5 sessions (Decision #217(k)). Gross stays in the one currency it was taken in
  and is converted through `FxService` into the display currency only when it spans several; a
  currency with no rate counts as nothing, never 1:1. The window ends on the last rolled-up UTC day
  (`lastRolledUpDay`: yesterday once the 02:10 job has settled at 02:30 UTC), so today is never in
  it and the canvas says so. Standing impact (#217(h)) counts the reviews on, and the project
  stages completed from, listings that carry a CREATE category; with none in scope the tile says so
  rather than printing 0.
- **The console header's rollups are the same tiles, not a second count.** `CataloguePage.stats`
  (the `CatalogueRollups` sentence) takes its gross volume, change, orders and conversion from
  `live-catalogue-analytics.ts#liveHeadline`: the same scope resolution, rollups read, window and
  pure `buildAnalytics` as `overview`, copied out of the tiles by `analytics-model.ts#headlineOf`.
  Its scope is the lane's type segment (`all` / `product` / `service`), which is also what the
  console's Analytics view covers unless an explicit `?scope=` (a delivery model or a collection)
  narrows it. The list read accepts every `AnalyticsPeriod`, `12m` included, so a period chosen on
  the Analytics view moves the header with it. Only what is live and the average review are counted
  by the list read itself. `analytics-headline.test.ts` holds the agreement on the pure copy and on
  the live read over a stub database.
- **The canvas** (`features/catalogue/components/analytics/AnalyticsCanvas.tsx`, shared by the
  console's `?view=analytics` and the workspace's `?tab=analytics`) fetches `/api/catalogue/analytics`
  after first paint, through the pure view-model `core/analytics-view.ts`. While a read is in flight
  it shows skeletons, and a failed read shows its reason and a Retry. It never shows zeros or the
  previous window's figures. A tile below its threshold prints "Not enough data yet", with the
  threshold in a tooltip. A funnel whose first step is under 20 is printed as counts, not drawn.
- `CatalogueClientsBackendService.pipeline` calls `catalogue.get_client_pipeline` once and maps it
  (`client-pipeline.ts`): rows outside the scope, or with no buyer handle (an order a team placed),
  are dropped; buyers fold into one card at their most urgent `laneOf` lane; action-required cards
  lead by severity (`dispute_open` › `revision_requested` › `reschedule_open` › `handshake_pending`
  › `submission_pending` › `inquiry_unanswered`), then recency. `client` adds the buyer's directory
  identity, the pair's one DM thread (read, never minted) and their open reschedule rounds through
  `ScheduleBackendService.openReschedules` (the calendar's own coordination read and privacy
  projection); a buyer with nothing in scope is a `404`.

Unlike the listing reads, these two have a **fixture path**: with `CATALOGUE_BACKEND_LIVE=false` they
answer deterministic fixtures for each state of the `catalogueAnalytics` / `clientPipeline` dev axes
(`?sim=`, ignored live), built over the fixture catalogue and passed through the same pure modules.

Every write drops the public catalogue's cache (`invalidateCatalog`) and re-embeds what it touched
(`reembedInBackground`); a listing's embedding text includes its search tags and its search-result
description (`core/embedding-text.ts`). Seller-ness is **not a hard server-side redirect**: the Dev
Context Switcher must be able to flip an authed dev to a seller persona at runtime, so no route
gates on `isFreelancer` (Decisions #14/#16/#48) and RLS plus the doors are the real access gate. The
publish gate (`publishReadiness`) is enforced client-side (to explain the Publish action) and in the
database. Feature history: Decisions #53 and #217.

**`WalletBackendService`** (`services/finance/`) is the context-scoped Wallet & Finance surface
(`/wallet` — one command-centre page and its action dialogs) — the 14th thin/fat read and the finance domain's first
WRITE surface, over the finance Zod SSOT (`@projective/types/finance`). Thin `WalletService` (client) →
`apiFetch` → `/api/wallet/{overview,switcher,transactions,activity,payouts,funding,methods,invoices,
access,action}` (thin routes = HTTP + Zod + guard, NO server capability gate) → the fat service →
`ServiceResult<T>`. **All money math is the fat service's** (or its `wallet-fixtures.ts`): the
three-state balance projection, the 5%-fee→vault-cut→template→remainder-to-vault team split
(finance-model §5), FX conversion + `Intl` formatting into the viewer's display currency, the KYC gate
— the client only formats the returned `MoneyView`s (never computes a balance/split/fee/conversion).
The read projections + action inputs + the `MoneyView`/`WalletQuery`/`WalletSim` shapes + the pure
`formatMoney`/`capabilitiesForRole` helpers are the SSOT at **`packages/types/finance/wallet.ts`**.
Stub-first behind **`FINANCE_BACKEND_LIVE`** (default off, `isFinanceBackendLive()`): the fat service
DERIVES a coherent finance world (a personal wallet + team/business vaults + an "All accounts"
aggregate) deterministically from the same cast as `/projects` + `/messages`, and — as a write surface —
mutates an **in-module session store** (top-up / withdraw / transfer / distribute / fund-escrow /
recurring / method / payout / spend / smoother) so the flows are exercisable with the gate off (no
persistence). **No DB migration** — a read+write projection over fixtures; the RLS-scoped `finance.*`
tables + money functions (the real engine, migrations 0009/0305/0310 + 20260723090000..094000) are the
deferred live path behind the same gate. The wallet is the **finance face of the active context**
(Decisions #16/#17): the same route resolves a different wallet via a `?w=scope:id` switcher override.
Full feature detail is logged in the root `CLAUDE.md` §8 Decision #55; the single-page presentation
that replaced the deep pages is Decision #122.

### Saved services (the one saved / favourites system, Decision #180)

Every star, save and favourite control writes through ONE path: `SavedService` (client,
`features/saved/core/`) → `/api/saved` (thin) → `services/saved/SavedBackendService.ts` (fat) →
`ServiceResult<T>`. The fat service keeps each kind's save in the store it already had — bookmarks
(`org.user_bookmarks`, fileable into `org.user_bookmark_collections`) for listings, people and
project channels; the project star (`projects.user_preferences`); the conversation star (dispatched to
`MessagingBackendService.setStarred` → `comms.set_dm_starred`); message favourites; the file owner's
star (dispatched to `FilesBackendService.star`) — and every write evicts the tenant's projects and
messaging read caches so the next read agrees. Follows stay `ProfileBackendService`'s; `/saved`
lists them read-only. **Live only** (like Profile and Files): there are no fixtures to save into, so
`dev:mock` answers 503 and the client rolls back; the Dev Context Switcher's `saved` axis substitutes
the set client-side. The client half is one optimistic discipline (`features/saved/core/optimistic.ts`:
apply → persist → roll back → announce) and one batched `/api/saved/state` lookup for the cards and
lanes whose own read carries no flag. Routes: ROUTING.md §Saved API. Zod SSOT:
`@projective/types/org` (`saved.ts`).

### Asset Management (`/files`) — two services, two gates

The asset hub is **two** thin/fat slices that share one screen, deliberately kept apart because they
have different trust models.

| Half             | Client (thin)         | Routes (thin)             | Service (fat)                             | Gate                        |
| :--------------- | :-------------------- | :------------------------- | :---------------------------------------- | :-------------------------- |
| The hub          | `FilesService`        | `/api/files/*` (20)       | `services/files/FilesBackendService.ts`   | **`FILES_BACKEND_LIVE`**    |
| The connectors   | `IntegrationsService` | `/api/integrations/*` (7) | `services/integrations/IntegrationsBackendService.ts` | **`INTEGRATIONS_BACKEND_LIVE`** |

Both default **off** (`isFilesBackendLive()` / `isIntegrationsBackendLive()` in `core/supabase.ts`),
both answer from deterministic fixtures, and both write into an in-module session store so every flow
is exercisable with the gates down. Cross-boundary shapes are the Zod SSOT at
**`@projective/types/files`** (`assets` · `folders` · `listing` · `upload` · `dedup` · `sharing` ·
`downloads` · `quota` · `storage` · `categories` · `kinds` · `sim`) and
**`@projective/types/integrations`**. Surfaces: `/files` + `/files/[...path]` (dashboard) and the
reusable Asset Picker; feature code in `apps/web/features/files/`.

**One method per method, one route per method.** Each `FilesService` method corresponds to exactly one
fat method **under the same name** (`list` · `tree` · `item` · `quota` · `dedupCheck` · `uploadInit` ·
`uploadComplete` · `attachLink` · `createFolder` · `rename` · `move` · `remove` · `setVisibility` ·
`createShare` · `revokeShare` · `resolveShare` · `downloadGuard` · `recordDownload` · `history` ·
`inspect`), so a reader crossing the boundary never translates. Islands import the client service, never
`@server/services/*` — that import edge is what keeps the credential-touching half out of the browser
bundle.

#### Why the gates are separate, and must stay separate

`FILES_BACKEND_LIVE` going live means the platform touches **its own storage under the caller's RLS**.
`INTEGRATIONS_BACKEND_LIVE` going live means the platform makes **outbound calls to a third party
carrying somebody else's stored credential**. A single flag would make "turn on the file hub" silently
mean "start acting at Google Drive on behalf of every connected user" — so the two are independent, and
`INTEGRATIONS_BACKEND_LIVE` additionally gates the token vault: with it off, `seal()` **refuses**
rather than returning a reversible encoding, because a stub that base64s a token and calls it sealed
writes a row indistinguishable from a real one that would survive the gate flip as plaintext.

#### Three invariants the fat service exists to hold

- **`canManage` and `downloadedByViewer` are server-derived on every row.** `canManage` is an
  *authority* decision (a mounted channel attachment is read-only in the hub by product rule, not by
  ownership arithmetic) — a client computing it would be deciding its own permissions.
  `downloadedByViewer` cannot come from `localStorage` at all: that store is per-browser, gets wiped,
  and is wrong the moment the same person opens the asset on their phone.
- **The owner of a write comes from the session, never the payload.** Every mutation takes a
  `FilesActor` the route derived from `ctx.state.userContext`; a payload `ownerType`/`ownerId` is a
  **request** to act as that principal, which `authoriseOwner()` (`services/files/acting-principal.ts`)
  either evidences or refuses. This is **identity, not capability** — it decides who is calling, never
  whether their persona or plan permits the operation, because a server-side capability bounce would
  make every Dev Context Switcher axis inert (the switcher is a client seam the server cannot see,
  §8 Decision #53(b)). Dev axes travel as separate validated `sim*` query params (`FilesSim`).
- **Quota is metered always, enforced only when the param says so.** The service warns; refusal waits
  on `security.platform_params.storage_quota_enforced` (seeded `false`). When it does refuse, the
  `entitlement.denied` analytics event is emitted by the **app layer**, not by the trigger — a `RAISE`
  inside Postgres rolls back the analytics row written moments earlier (§8 Decision #58).

#### The file inspector and the streaming proxy (Decision #161)

A stored file opens in a new tab at **`/inspect/[fileId]`** — a shell-free page (route group
`(standalone)`, no `_layout`) whose controller is `features/inspector/routes/InspectScreen.tsx`. Two
server doors feed it, and they keep the two halves of the rule above apart:

- **What the page knows — `FilesBackendService.inspect(id, { share }, actor)`** (`anyone`-wrapped;
  `services/files/live-inspect.ts`, the pure projection `toInspectAsset` in `inspect-dto.ts`). It
  mirrors `objectFor`'s three read branches (share slug → `fn_resolve_share` + a service read; signed
  in → the user's client under RLS; anonymous → the anon client), admits only `source = 'supabase'`,
  `status = 'uploaded'`, not deleted, and returns one `InspectAsset` (`@projective/types/files`
  `inspect.ts`), validated with `InspectAssetSchema` before it leaves (a mismatch is a `503`). Every
  refusal is `404`. The canvas is chosen by the pure `resolveViewer(name, mime)` — extension first,
  stored type second — and a file whose original no browser draws (HEIC, TIFF, PSD) shows its `lg`
  WebP rendition, or the unsupported fallback without one. `access` (owner · member · share · public),
  `canManage`, `shareUrl` (the newest live item link, managers only) and `downloadCount` (managers
  only) are server-derived; the owner's handle, name and avatar come from `org.profiles_index` (the
  public profile door), so an owner with a private profile shows as `null`. **Every address on the
  DTO is a same-origin proxy or page route** — `AssetItem.url` / `thumbnailUrl`, which can be raw
  storage URLs, are never carried over. The page handler (`core/inspector-ssr.ts`, server-only) calls
  it directly, without an HTTP hop; the preview modal reads the same DTO through the thin
  `GET /api/files/inspect?id=&share=` (`FilesService.inspect`, `null` on a `404`; Decision #162).
- **The bytes — `MediaBackendService.streamAsset(actor, fileId, request)`**, behind
  `GET|HEAD /api/media/proxy/[fileId]` (a one-line delegate to `services/media/stream.ts`
  `streamAssetFor`; transport `core/storage-stream.ts` `fetchStoredObject`). Same gate as
  `/api/files/object/[id]` (`objectFor`, unchanged), but the response is STREAMED from storage's
  internal origin instead of a `302` to a signed URL, so the page never sees a storage host, bucket,
  path or signed URL. Range / conditional requests pass through (206 · 304 · 416), headers are built
  from an allowlist with a never-`text/html` type policy and a sandbox CSP on anything not
  inline-safe, a share read is `no-store`, and a read never counts a download. A top-level
  navigation to the proxy ("Open image in new tab") is a `303` to `/inspect/[fileId]` unless
  `?raw=1` / `?download=1` (`features/inspector/core/proxy-navigation.ts`). Full contract:
  `documentation/database/files/Storage.md` §The upload pipeline. It sits under `/api/media/*` because
  the media services own byte delivery (`ROUTING.md` §Profile and media API). Since Decision #162 it
  is also the address every stored asset's preview and grid thumbnail carries (below); the redirect
  route stays only for its remaining consumers.

The page's canvases are islands that `fetch` the proxy (or point `<img>` / `<video>` / `<audio>` at
it) and load their engines — `three`, `pdfjs-dist` (legacy build), `highlight.js`, `dompurify`,
`docx-preview`, plus the existing `marked` — only by a memoised dynamic `import()` inside an effect,
never at module scope (Fresh's server snapshot evaluates every island module). Their decoder and
font trees (pdf.js wasm / cmaps / standard fonts / ICC profiles, three's Draco and Basis
transcoders) are served same-origin under **`/vendor/<lib>/<version>/…`** by the `vendorAssets()`
plugin in `vite.config.ts` (streamed from `node_modules` in dev, emitted into the client build for
`serve`); the paths come from `features/inspector/core/vendor-paths.ts`, versioned because Fresh marks
client-build files immutable. Engines only, never their CSS — every surface is reskinned with tokens
(Decision #161(E)). Fresh's Deno resolver ignores a package's `browser` field, so the client build
resolves `jszip` (docx-preview's dependency) to its self-contained browser bundle through the
`browserEntries()` plugin in `vite.config.ts`; bundled from its CommonJS `lib/`, the converted module
throws on load and the `.docx` canvas fails in production only.

#### Asset addresses and the preview modal (Decision #162)

**Every stored asset's address is the proxy.** `AssetItem` carries `assetId` — the `files.items`
uuid — beside `id`, which on a project, channel or conversation row is the
`comms.message_attachments` link id (one file posted twice is two rows) and on a hub row equals
`assetId`; `MessageAttachment` carries `assetId`, `mimeType` and `blurhash`. The producers build
every stored, uploaded file's addresses as `url = mediaProxyHref(assetId)` and, for an image,
`thumbnailUrl = mediaProxyHref(assetId, { tier: "sm" })` — `asset-row.ts` `assetAddress` (the hub,
public buckets included), `projects/live-files.ts`, `messaging/live-workspace.ts` — and a chat tile
as `mediaProxyHref(assetId, { tier: "md" })` (`projects/message-attachments.ts`). Project and
conversation rows read the stored upload metadata too (`withMediaFacts`: width, height, BlurHash).
Fixtures, web links and connector files keep their own URLs. The browser never sees a storage
host, bucket, path or signed URL in a listing; `/api/files/object/[id]` remains for the library
picker (`media-pick.ts`) and the share-folder listing (`live-library.ts`). The client resolver is
`apps/web/features/files/core/asset-media.ts` (`assetMediaSrc` · `assetMediaSrcset` ·
`assetPlaceholder`), a pure module that falls back to the row's own URL when there is no stored
uuid. Cost, flagged: each thumbnail is a proxied read holding a request worker and counting against
the per-identity 1,200-a-minute window (Decision #162 flag (c), #161 flag (g)).

**The preview modal embeds the inspector; it does not reimplement it.** `AttachmentPreviewModal`
(`features/projects/components/preview/`) fetches the asset's `InspectAsset` through
`FilesService.inspect` (a page-lifetime signal cache keyed by asset id) and mounts the inspector's
viewer through `useInspectorHost(asset, { signedIn, embedded: true })` (`features/inspector/hooks/`)
and the `components/embed/` components. `createInspectorShell(asset, options)` takes
`InspectorShellOptions { urlSync, print, embedded }` (all defaulted for `/inspect`, so that page is
unchanged); embedded means no `#L` hash reads or writes, no print dialog or print listeners, and
key listeners scoped to the `data-ins-key-scope` element rather than `document`. The registry maps
`model` to a handoff card in embedded mode (`embedModelHandoff`), because the app CSP keeps
`'wasm-unsafe-eval'` and `blob:` connect page-scoped to `/inspect` (#161(D)). A row with no stored
bytes renders the legacy `FilePreview`.

**Where a file came from.**
`MessagingBackendService.attachmentSource(assetId, actor, { conversationId })` →
`services/messaging/live-attachment-source.ts` (`fetchAttachmentSources`) reads `comms.message_attachments` by `attachment_id` (index `idx_message_attachments_attachment`)
under the caller's JWT — RLS `view_attachments_if_member` (`comms.can_read_message`) decides what
comes back — then the DM or project message (deleted ones excluded), the senders and, for a
project message, the project and stage slugs for the link. It returns `AttachmentSource[]`
(`@projective/types/projects`), newest first: `/messages/<thread>?m=<id>` for a DM,
`/projects/<prj-…>/<stg-…>/chat?m=<id>` for a stage room, `…/discussion/chat?m=<id>` for the
project-wide room, and the room uuid for a private room with no other address (Decision #162 flag
(h)). The excerpt is the stored body — already masked at write time — collapsed and cut at a word
to 280 characters. A guest, or any failure, gets `[]`; mock mode answers from the fixture
conversations. Served by `GET|HEAD /api/messaging/attachment-source` through the messaging read
cache (ETag); the client is `MessagingService.attachmentSource`.

#### The connector adapter interface

`StorageAdapter` (`services/integrations/adapters/StorageAdapter.ts`) is the seam that stops a
connected Drive from becoming a second file model. Implementations ship for `google_drive`, `dropbox`,
`frameio` and `s3`, each stub-first behind `INTEGRATIONS_BACKEND_LIVE` and each documenting the exact
provider API surface its live branch will call.

```ts
interface StorageAdapter {
  readonly slug: string;                 // integrations.providers.slug
  readonly source: AssetSource;          // the source a produced row carries
  list(path: DrivePath, cursor: string | null, limit: number): Promise<StorageListing>;
  metadata(id: string): Promise<AssetItem | null>;
  downloadUrl(id: string): Promise<string | null>;
  thumbnailUrl(id: string): Promise<string | null>;
}
interface StorageAdapterContext { connection: UserConnection; accessToken: string | null; }
```

Four decisions in that shape carry weight:

1. **It returns `AssetItem` / `AssetFolder`, never a provider row.** The picker, the grid, the table
   and the preview modal are then *literally the same components* for a mounted Drive file and a
   hub-native upload. A connector-shaped return type would need a second card family within a week.
2. **Paging is the provider's.** `cursor` is their opaque continuation token echoed back **verbatim**;
   a connector that pages by token cannot be resumed from an id we invented, and normalising one into
   the other loses rows silently at the boundary.
3. **A location is addressed two ways because the families genuinely differ.** Object stores (Drive,
   Dropbox, Frame.io) have folder objects with ids; key-prefix stores (S3) have no folder objects at
   all, only a delimiter convention. `DrivePath { folderId, path }` carries both rather than inventing
   ids or discarding the prefix.
4. **`downloadUrl` / `thumbnailUrl` are async and per-call.** Caching one on the asset row would
   persist a credential-bearing URL into a projection the client reads, and a signed URL that outlives
   its purpose is a leaked capability.

Mounted rows are **read-only in the hub, always** (`canManage: false`) and **never consume our quota**
— the provider meters them. The hub shows a connected drive so a person can find and attach what they
already have, not so it becomes a second write path into someone else's system of record, where a
rename here would silently rename a file their whole team depends on.

#### Link ingest is the most dangerous path, and it is gated shut

Attaching a link means **the server fetches a URL a stranger chose** — an SSRF primitive by
construction. `services/files/link-scan.ts` keeps the outbound fetch behind `FILES_BACKEND_LIVE`;
until then it answers offline (the Safe Browsing test host is `blocked`, a suspicious shape is
`suspicious`, `http:` is `unscannable`, anything else `safe` with a title from its path) and touches no
network. The live path (Decision #128) is split so each requirement is auditable: `link-guards.ts`
parses IPv4/IPv6 itself (mapped, NAT64, 6to4 and Teredo forms included) and refuses loopback,
link-local (including `169.254.169.254`), private, CGNAT, unique-local, multicast, reserved and
unspecified ranges, IP literals, credentials in the URL, lookalike hosts and non-standard ports;
`link-fetch.ts` allows `https:` only, **resolves DNS first and refuses the whole host if ANY answer is
forbidden** (rebinding), then **connects to the pinned, checked address itself** (`Deno.connect` +
`Deno.startTls` with the hostname, so SNI and certificate verification still name the host) and
speaks a minimal HTTP/1.1 (`Connection: close`, `Accept-Encoding: identity`, chunked decoding) with
**no** ambient credential; it re-validates **every** redirect hop (max 2), enforces a hard 5 s
deadline by closing the socket, and a **stream-enforced** 512 KiB cap (`Content-Length` is
attacker-supplied and a chunked response has none); `link-reputation.ts` asks Google Safe Browsing
(`LINK_SAFETY_API_KEY`); `link-favicon.ts` **re-hosts the favicon** into `public_assets` (the same
guarded fetch, an image sniff, 64 KiB) rather than hotlinking it, because a hotlinked favicon sends
every viewer's IP to a host the link's author chose. Verdicts are cached per URL (safe 1 h, flagged
24 h, unscannable 10 min) and concurrent scans of one URL share one promise. The verdict axis keeps
`unscannable` distinct from `suspicious`: *"we could not reach it"* is not *"we found something"*.
Pinned by `link-scan.test.ts` (guards, rebinding, redirects, caps, deadline, favicon).

#### The token vault

`services/integrations/token-vault.ts` implements **envelope encryption** for
`integrations.connection_secrets`: a per-secret data key (DEK) encrypts the token, and the DEK is
itself wrapped by a KMS-held key-encryption key (KEK) recorded on the row as `key_id`. Rotating the
KEK re-wraps DEKs and never touches ciphertext; the plaintext KEK never exists in application memory;
and old and new KEKs coexist during a rotation instead of it being a flag day. Service-role only —
`connection_secrets` has RLS on, **no policy, no view, no `authenticated` grant**, so column safety is
structural rather than a policy someone could loosen. Clients read
`integrations.v_my_connections`, which physically cannot project a token column.

> ⚠️ **Flagged contradiction, not resolved here (§8 Decision #59).** The Environment Variable Contract
> below carries **`ENCRYPTION_KEY`** — a single, symmetric, process-wide secret. That is a *different*
> design from the KMS envelope the `integrations` schema was built for (`connection_secrets.key_id`
> exists precisely because the wrapping key is external and rotatable). They cannot both be right: if
> `ENCRYPTION_KEY` is authoritative, `key_id` is decoration and rotation is a full-table rewrite; if
> the envelope is authoritative, `ENCRYPTION_KEY` must be removed from the contract or redefined as a
> local-development KEK never used in production. The module implements the **envelope** interface,
> because that is what the schema requires and it is the one that can absorb the other. **A human
> picks the winner, and updates the contract in the same change.**

#### Database

The schema is documented in [`documentation/database/files/`](../database/files/) — `Tables.md`,
`Policies.md`, `Functions.md`, `Storage.md`. Migrations: `00000010` (tables), `00000030` (the one
permitted trailing FK, to `integrations.user_connections`), `00001160` (seven functions), `00001880`
(triggers), `00002001` + `00002011` (RLS + policies), `00002017` (the `workspace` bucket's
`storage.objects` policies), `00004011` (indexes), `00005040` (buckets). Quota rides the existing
entitlement resolver via the `storage_megabytes` key — no parallel billing path.

### Basket, Checkout & Orders — the four-step flow

The universal basket and the four-step `/checkout` are **three fat services on one gate**, all
`services/finance/` and all behind the **existing `FINANCE_BACKEND_LIVE`** (`isFinanceBackendLive()`
in `core/supabase.ts`). **No new env key, and no DB migration** — like `/wallet` this is a read+write
projection over deterministic fixtures plus an in-module session store, and the RLS-scoped
`finance.baskets` / `basket_items` / `saved_cards` tables (already authored and documented) are the
deferred live path behind the same gate with zero shape churn.

| Half        | Client (thin)      | Routes (thin)                                                        | Service (fat)                |
| :---------- | :----------------- | :-------------------------------------------------------------------- | :--------------------------- |
| The basket  | `BasketService`    | `/api/basket/{index,item,move,promo,lists,owners}`                   | `BasketBackendService`       |
| The flow    | `CheckoutService`  | `/api/checkout/{session,create,details,approval,order,calendar/[orderId]/[lineId]}` | `CheckoutBackendService` |
| The wallet of cards | `CardsService` | `/api/cards/{index,[id],default}`                                  | `CardsBackendService`        |

`approval` is a business checkout's "Request approval" (Decision #243): it files a spend request
bound to the basket through `wallet-actions.fileSpendRequest` → `finance.request_spend_approval` —
the one door `/wallet` files through too — with the amount computed server-side from the named
lines, and answers the fresh session in the page's deep-link scope (`preselect`) with a sentence. A
PC409 that the session does not show as the member's own is another member's request on the shared
basket and answers 409 saying so; a "needs no approval" the session disagrees with answers 409 too.
The spend pre-flight (`live-buyer.spendPositionFor`) reads what the database's gate reads: the
envelope rolled at `resets_at` and the platform threshold behind a wallet's NULL one. Database
refusals at Pay map to blockers in `checkout-refusal.ts`; a business refusal carries its `gate` so
the surface words it from the business refusal map.

Cross-boundary shapes are the Zod SSOT at **`@projective/types/finance`** — `basket.ts` (items,
lists, the `BasketLists` projection), `checkout.ts` (the session context, `CheckoutTotals`,
`CheckoutBlockerCode`, `CreateCheckout`), **`buyer.ts`** (`PostalAddress` · `DeliveryDetails` ·
`PersonalBilling` / `BusinessBilling` · `BillingContext` · `MonthlyInvoicing` · `BuyerDetails` +
the completeness predicates `missingBuyerFields()` / `buyerDetailsComplete()`), and **`order.ts`**
(`Order` · `OrderPage` · `OrderLine` · `FulfilmentKind` + `fulfilmentKindOf()` · `OrderInvoice` ·
`TaxBreakdown` · `CalendarLinks` + `calendarLinksFor()` / `buildIcsCalendar()`).

**Two reads were added for the flow's new steps, and both are projections, not new storage.**

- **Buyer details** — `CheckoutBackendService.details(query)` and `saveDetails(input, query)` over
  `services/finance/buyer-fixtures.ts`. `saveDetails` returns the refreshed **session** alongside the
  saved record, so a save that clears the `missing_details` blocker updates the gate in one round trip
  instead of leaving the client to re-derive it.
- **Orders** — `CheckoutBackendService.order(query)` over `services/finance/order-fixtures.ts`, whose
  `createOrder()` is called from `create()` so `CheckoutResult.orderId` is finally non-null (this is
  what closes §8 Decision #68 flag (g)). The confirmation step is therefore a **GET over the order
  projection, never a re-POST of `create()`** — the idempotency ledger is a process-local `Map` with
  no TTL, so a page that re-charged on refresh would work in dev and double-charge in production.

**The ICS route is the one exception to the JSON envelope.** `/api/checkout/calendar/[orderId]/[lineId]`
returns `text/calendar; charset=utf-8` with a `content-disposition: attachment` filename and
`X-Content-Type-Options: nosniff`; it is reached by a plain anchor `href`/`download`, not through
`apiFetch`. It delegates to the SSOT's `buildIcsCalendar()` — there is no second RFC 5545 builder.

**All money arithmetic stays server-side and single-pathed:** `basketSubtotal` → `applyDiscounts` →
`platformFeeFor` → `checkoutTotals`, executed by the fat service, which wraps integer minor units into
`MoneyView`s the client only renders. No `toFixed`, no `Intl.NumberFormat` and no `reduce`-over-prices
in any island. `create()` is idempotent on its `idempotencyKey` and **re-verifies `expectedTotalMinor`**
against a freshly computed total, so a client-supplied total is never accepted on trust — which is why
every input to the total (the voluntary `processingContributionMinor`, the chosen `billingContextId`)
must be threaded through **both** `session()` and `charge()` or every payment refuses with
`price_changed`.

**No server capability guard**, for the same reason as `/catalogue` and `/files`: the `(dashboard)`
middleware bounces guests, the deferred `finance.*` RLS is the real gate, and a server-side capability
bounce would make half the Dev Context Switcher unreachable (the switcher is a client seam the server
cannot see). The ten checkout dev axes travel as validated `sim*` query params (`BasketSim`, parsed by
`services/finance/basket-query.ts`) and are ignored on the live path.

**Platform fee — one rate, one rounding rule (§8 Decision #187, closing #68(b)).** `platform_fee_bp`
is seeded `500`. Every fee path resolves the PAYER's effective rate through
`finance.fn_effective_platform_fee_bp` (escrow releases via `fn_escrow_fee_bp`, `place_wallet_order`
for the basket owner, `preview_team_split` for the escrow's payer) and truncates
(`(amount × bp) / 10000`). The checkout previews the rate `get_purchase_owner` returns as
`platform_fee_bp` and rounds with the SSOT's `platformFeeFor`, which truncates the same way;
`PLATFORM_FEE_BP` is a display fallback only, pinned to the seed by a unit test. (Decision #68(a), "`authenticated` has no `USAGE` on
the `finance` schema", is **no longer true**: `00002500` grants it, and the finance policies have been
live since the 2026-09-23 ledger pass — see `database/finance/Policies.md`.)

### The Entity View — polymorphic archetype resolution

`/view/[entity]` is a **read** surface over `ExploreBackendService.viewPage(id)` behind
`EXPLORE_BACKEND_LIVE`, and it is the clearest instance of the slot-resolver pattern doing real
architectural work rather than layout plumbing.

> ⚠️ **Flagged, not resolved here (§8 Decision #179(c)).** `viewPage` no longer sits behind
> `EXPLORE_BACKEND_LIVE`: every discovery read is live with no fixture fallback
> (`ExploreBackendService`), and the flag now gates only the discovery telemetry writes and
> stub-mode saves. The sentence above, the Environment Variable Contract's gate comment and Decision
> #12 still describe the stub-first design. A human decides how to reword them.

**The archetype is resolved server-side, once.** A pure `resolveArchetype(item, view)` maps a
listing's delivery model onto one of five bodies — `pipeline` · `one_off` · `session` · `cohort` ·
`product` — and both the canvas and the conversion lane are driven from that single answer. It keys
on the **resolved item**, never on `?type=` in the URL, which is presentational SEO only: a query
string is caller-controlled, and a body that trusts it can be made to render a purchase control for
a listing that is not for sale.

**Two regions, one offer, resolved by two members of the same resolver family.**
`viewLaneFor(url, authed)` supplies the transactional lane and `viewHeaderFor(url)` the
scroll-migrated sub-header; both are pure, synchronous, URL-keyed and composed by the `(public)` and
`[handle]` layouts, so the correct chrome paints in the first SSR byte. Neither may be an island — a
client-resolved lane cannot paint on the first byte and would flash an empty rail on every
navigation.

**Money crosses the boundary already resolved.** The fat service returns integer minor units plus
the resolved `EntityPricing`; the client renders through `MoneyView` and never totals, converts or
formats a figure itself. The card that linked here and the page it opened share the same pricing
resolver, so they cannot quote different numbers (§8 Decision #45).

**Availability and capacity are server facts too.** Seat counts, next-available slots and stage state
are computed by the service and rendered as given — a client that derives them re-derives them
differently the moment a fixture changes.

### The Public Profile — live reads, one write door, and the media pipeline

`/[handle]` is **live-only** (2026-09-23): there is no fixture profile and no backend gate. The fat
`ProfileBackendService` (`@server/services/profile/`) reads through the `org.get_profile_*` definer
functions and writes through `org.save_profile` / `org.set_profile_avatar` / `org.save_showcase`
(see `database/org/Functions.md`), under the caller's own JWT. Three rules shape it:

- **The database decides visibility and ownership.** Every read answers `NULL` for an unknown
  handle and for a hidden one alike (404 either way, so a private profile's existence is never
  disclosed), and a failed read is a **503**, never an empty profile — `undefined` means "could not
  ask", `null` means "asked, and there is nothing you may see". The owner views are gated on the
  read's `viewer.isOwner`, never on the unverified chrome token, and the `edit` routes guard in
  `define.handlers`.
- **Raw facts in, presentation out.** The SQL returns storage references and codes; the mapping to
  the `ProfileView` Zod SSOT (labels, Standing tiers, URLs, `srcset`) happens once, in TypeScript.
  URLs are built in exactly one place (`core/storage-url.ts`), because a URL is a deployment fact.
- **A person's picture has one door.** Every surface that shows OTHER people — project rosters and
  feeds, message senders, contact pickers, the nav's account button — resolves names and avatars
  through `org.get_party_cards` (`profile/party-cards.ts`), so a new avatar reaches all of them on
  their next read. The open tab updates at once through a `pj:avatar-changed` window event
  (`apps/web/utils/avatar-sync.ts`), which the nav's account island listens for.
- **A person's picture has one ranking.** `@projective/types/user` (`avatar.ts`) is the only code
  that orders avatar sources: the uploaded photo at the surface's tier (`avatarTierFor` — `sm` ≤ 48px,
  `md` ≤ 128px, `lg` beyond, per `TIER_LONG_EDGE.avatar`), else the sign-in provider's picture
  (`get_party_cards.oauth_avatar`, user-writable, so rendered only through the provider-host allowlist
  `safeOAuthAvatarUrl`), else `null`. The server applies the first two rungs (`party-cards.ts`,
  `UserBackendService.me`); the UI applies the third — `UserAvatar` paints `DEFAULT_AVATAR_URL` for a
  `null` and for a photo that fails to load, with initials beneath (Decision #127).

**The media pipeline** (`@server/services/media/`) is the only way bytes reach a public bucket:

1. **Quarantine.** The browser declares an upload (`files.items` at `pending_upload` in
   `quarantine`, the only shape `files.fn_guard_pipeline_columns` lets a client write) and PUTs the
   bytes to a signed URL under its own id prefix.
2. **Validate.** The service role claims the row (`pending_upload → scanning`, one winner), then
   **sniffs the magic bytes** — the declared type and extension are never trusted — and refuses and
   deletes anything that is not a picture or video it can read (`quarantined` for an executable or
   markup file, `error` otherwise).
3. **Decode + tier in a Worker pool** (`image-worker.ts`, `image-codec.ts`): decoding is itself the
   proof the file is the picture it claims to be; three WebP tiers are written per the SSOT's
   `TIER_LONG_EDGE`, never upscaled, with a BlurHash and colour summary for the placeholder. A video
   is never decoded server-side: the browser extracts its poster still, which is sniffed and tiered
   like any image.
4. **Admit** the original to the owner's private library (`personal/users/{id}/library/{asset}/…`),
   write `files.item_variants`, mark `uploaded`, delete the quarantine object. A pipeline or storage
   failure resets the row so a retry can finish it.
5. **Renditions.** Placing an image on the profile cuts a **rendition** server-side from the library
   ORIGINAL with the shared crop model (`@projective/types/files` `crop.ts` — the same arithmetic the
   browser previews), re-encodes it (which also strips EXIF and anything a polyglot could carry) and
   writes it with its tiers to the public `avatars` or `showcase` bucket, where only the service role
   may write. The attach RPC then re-checks that the rendition belongs to the profile's owner. Each
   target has a crop SHAPE (`RENDITION_SHAPE`): the avatar is clamped to its visible CIRCLE, so it
   can reach every edge of the picture at any rotation and its minimum zoom does not change as it
   turns; the square stored around it may overhang the picture, and the cut fills those corners from
   the nearest edge pixel (no surface shows them). The showcase frame is clamped as a whole box.
6. **The sign-in picture** (`/api/media/oauth-avatar-sync`, `services/media/oauth-avatar.ts`). The
   provider's picture is never read by the browser (a canvas drawn from the provider CDN is tainted,
   and the URL is user-writable metadata). The server reads the URL from the caller's VERIFIED
   identity (`UserBackendService.oauthAvatar`), checks it against the provider allowlist, fetches it
   under the link guards (`files/link-fetch.ts` — https, pinned DNS, no private addresses, an 8 MiB cap,
   one deadline), re-checks the final host after redirects, sniffs the bytes, and then runs the SAME
   quarantine flow a browser upload takes (declare → service-role write to the declared quarantine
   object → complete). The result is an ordinary library asset; nothing about the profile changes
   until the person frames it and saves.

The picker for all three rendition surfaces (the profile photo, a showcase slot, a group conversation
photo) is the File Picker in **media mode** (`AssetPicker` `media`, `files/components/media-crop/`):
Upload from device · Projective Library · Sign-in account, then a fixed-size Crop & Adjust stage
(rule-of-thirds guides, an infinite rotation ruler, Reset) whose save hands the source and its crop to
the host — `/api/profile/[handle]/media` or the group-photo route (Decision #158). It runs in two
steps, Browse → **Continue** → Crop → **Save & Apply**: adding to the showcase chooses up to as many
sources as there are empty slots (a chosen card toggles off), each framed in turn with circular
chevrons and an active tray. **Nothing is written before Save & Apply** (Decision #160): a device file
is held in the tab as an object URL and the sign-in picture is only previewed; on save each goes
through the quarantine pipeline above, then the renditions are cut. Cancel revokes the blobs and
leaves `files.items` untouched.

`MediaBackendService` also owns the READ side of private bytes for the file inspector:
`streamAsset` streams a library or project object through `/api/media/proxy/[fileId]` after the
files read gate, never writes and never counts (Decision #161; §Asset Management → The file inspector
and the streaming proxy).

Gaps, stated: there is no third-party **malware** scan yet (the checks are a content sniff and a
full decode), and variant bytes are not metered against the owner's storage quota.

### Teams & Businesses — the workspace console (live-only)

`/teams` and `/businesses` are **live-only** since 2026-09-28 (root `CLAUDE.md` §8 Decision #61),
like the profile: the fixture corpus (`workspace-fixtures.ts`), its six Dev Context Switcher axes and
the `WORKSPACE_BACKEND_LIVE` gate are gone. The fat `WorkspaceBackendService`
(`@server/services/workspace/`) is async, takes the caller's `ReadActor`, answers a guest `401`, and
reaches the database only through definer RPCs under the caller's JWT
([`../database/org/Functions.md` § The workspace console](../database/org/Functions.md#-the-workspace-console-00001020),
[`../database/finance/Functions.md` § Workspace money governance](../database/finance/Functions.md#-workspace-money-governance-00001210-13)).
Every write returns the RE-READ console so an island adopts the server's state. Four rules shape it:

- **One permission engine, two implementations that cannot drift.** The console's authority is
  three layers — a preset role, a custom role, per-member overrides — resolved as
  `role ∪ granted − revoked` over the one enum `org.workspace_capability`. `@projective/types/workspace`
  (`capabilitiesForKind`, `PRESET_GRANTS`, `roleRank`, `effectivePermissions`) decides what the
  console RENDERS; its SQL twin (`org.fn_kind_capabilities` / `fn_preset_capabilities` /
  `fn_preset_rank` / `fn_member_capabilities` / `fn_member_can`) decides what the database ALLOWS.
  `packages/types/workspace/workspace.contract.test.ts` reads the migration and pins the twin to the
  TypeScript (kind subsets, preset bundles, ranks, the reserved-handle list, the enum order). Every
  write RPC gates on a capability, never on a role name, and the hard rules — never your own row,
  only someone you outrank, never grant what you lack, exactly one owner who moves only by transfer —
  are enforced in SQL, with the islands merely echoing them.
- **Money authority is a projection, not a second editor.** `finance.vault_permissions` — what every
  money function enforces — is rewritten from the workspace capabilities by
  `org.fn_sync_vault_permissions` on every membership, role and override change and on every
  team/business wallet insert, and `finance.fn_has_vault_capability` additionally requires CURRENT
  membership. So a removed member cannot keep `withdraw`, and a new entity's owner can spend from
  birth. Deciding an over-limit spend is its own grant (`approve_spend`), because the owner-level
  `manage_members` also carries `withdraw`.
- **Raw facts in, presentation out.** `org.get_workspace_roster` / `get_workspace_detail` return ids,
  file ids, codes and instants; the fat service maps them onto the Zod SSOT once, resolving people
  through `org.get_party_cards` (`profile/party-cards.ts`) and pictures through
  `files.get_public_media` + `core/storage-url.ts`. Balances and ledgers are read under the caller's
  RLS with the wallet surface's own entity projection, never re-derived. The mapping also answers
  each viewer only what is theirs to act on: an activity line that moves money reaches only a
  viewer who may open Finance (`visibleActivity`), and every Draft-First setup step carries
  `actionable` from `canActOnSetupStep` (`@projective/types/workspace`) — the same right that opens
  the step's module, pinned by `module-registry-gates.test.ts`; a team's owner-verification step is
  the exception, actionable only for the owner (the read marks the viewer's own row against
  `owner_user_id`) and linked to their `/settings/verification`, and a `pending` verification is
  actionable for nobody — so the Overview's pure model
  (`features/workspaces/core/overview-model.ts`, Teams C1) never draws a control its viewer cannot
  use. The Overview's setup-hero dismissal lives in localStorage, so an inline pre-paint guard
  (`heroDismissGuard`, allowed by the `'unsafe-inline'` `script-src` in `utils/csp.ts`; a
  nonce-based policy must carry it) hides the band before first paint, and the island's first
  client render reads the same key and carries the same `data-hero-dismissed` mark: Fresh's revive
  renders over the server's DOM and removes every attribute its tree lacks, so a mark set only by a
  pre-paint script is dropped at revive and the band flashes back.
- **The acting context is written only by the switch RPCs.** (Its enterprise targets are listed by
  `GET /api/context/enterprises` → `ContextBackendService.enterprises`: owned or ACTIVE-member
  enterprises, archived excluded, filtered explicitly because the `org.enterprises` SELECT
  policy also admits platform admins to every row.) `security.session_context` is
  SELECT-only to clients; `POST /api/context/switch` → `ContextBackendService` calls
  `security.switch_session_context` (freelancer | business), `switch_team_context`,
  `switch_enterprise_context` or `clear_session_context` (back to personal), each of which re-checks
  the membership it names and upserts one slot (`ck_session_context_one_slot` makes a second
  unrepresentable). The access-token hook re-checks that membership at **every mint** and drops a
  stale context to personal — the stored context is a preference, never a grant — and the chrome's
  `role` is `admin` for the owner/admin presets, else `member`. After a switch the caller refreshes
  the session so the new claims are minted. The `/wallet?w=` scope stays a page-local view filter,
  distinct from this switch.

Refusals follow one convention: an RPC raises `22023 '<field>: <reason>'`, which the service maps to
a 422 with `fieldErrors[field]`; `42501` → 403, `P0002` → 404, `23505` / `55000` → 409, `23514` →
422, anything else → 500 with a generic sentence (the real error is logged).

### The Settings engine — one taxonomy, two surfaces (Decision #151)

Settings exist in two places that must never disagree: a **contextual modal** any page opens
(`?settings=<section>`, a gear's `openSettings()`), and the **`/settings` console** (a middle-nav
lane + one page per section). Both are drawn from the same three pieces:

- **The registry** — `features/settings/core/settings-registry.ts`, pure and isomorphic: eleven
  sections (`SettingsSectionKey`, owned by `@projective/types/settings`) and every searchable entry
  with its label, keywords, `anchor`, `surface` (`modal` · `page-only` · `status-escalate`) and an
  optional `gate(ctx)` evaluated against the EFFECTIVE context (dev persona axes apply). Search,
  the modal's tree, the lane's tree, the attention marks and the phone drill-down all read it.
- **One read per section** — `resolveSettingsSection` (`core/settings-ssr.ts`) composes the services
  that already own each section's data (`SettingsBackendService` for identity + appearance,
  `EmailsBackendService`, `NotificationCenterBackendService`, `MessagingBackendService`,
  `ProfileBackendService`, `PaymentBackendService`, `IntegrationsBackendService`). The console page is
  server-rendered from it; the modal fetches the same payload from `GET /api/settings/[section]`.
- **One renderer** — `SettingsSectionView` draws a section on either surface. In the modal a
  `page-only` section (Scheduling — the weekly schedule is a matrix) and a `status-escalate` one
  (Verification and Integrations — their actions leave for Stripe or a provider's consent page) show
  their STATUS and one escalation into the console; nothing is ever hidden or disabled there.

**The hub and the account lifecycle (Decision #156).** `/settings` is a hub: an in-page search over
the registry (`searchSettings`, the same rule the lane and the modal filter with); "Needs your
attention"; a profile completeness tracker (the `org.fn_compute_profile_setup_progress` score and ONE
call to action to its suggested step, routed by `features/shell/core/setup-actions.ts`); and every
section as an interactive card that opens it, listing its matching settings as links while searching.
The attention FACTS grew three parts — `profile` (score, pending steps, next action), `billing` (saved
cards expired or expiring this month or next — `cardExpiryCounts` — and the plan's state) and
`security` (sign-in methods, whether another provider can be connected, and any scheduled erasure) —
still read once per request (`attentionFactsFor`) and turned into items by the pure `attentionItems`.
The lane, the hub's cards and the modal's tree all draw the same **dot badge** per section (shape per
tone: a filled dot, a ring, a square), the modal reading the facts from `GET /api/settings/attention`
through the `useAttention` hook. Account composes three new services: `AccountLifecycleBackendService`
(the handle policy, giving up the freelancer profile, deleting the account, cancelling — all over the
`00001060` definers in the caller's JWT, plus `sweepDue` for the scheduler), `IdentitiesBackendService`
(GoTrue identities: the list from `auth.getUser`, provider availability from GoTrue's own
`/auth/v1/settings` cached five minutes, a link as a PKCE `linkIdentity` whose verifier alone leaves as
a cookie and comes back through `/api/auth/callback`, an unlink over REST refused for the email
identity and the last sign-in method; linking needs `[auth] enable_manual_linking = true`) and
`PlanBackendService` (the held plan or the free default, read-only). Language reads and writes the new
`date_format` column in its own statement so an older database degrades to "follow the locale". The
dev `accountLifecycle` axis substitutes the handle policy or the lifecycle answers.

**Islands stay dumb.** The modal host and the console islands only `fetch` `/api/*` through
`SettingsService`; every write is an existing or new thin route over a fat service. The modal's
eleven sections are a lazily-imported module (also their stylesheet carrier), so a page that only
renders a gear never ships them. The URL contract (push on open, replace between sections, strip on
close, `fClientNav: false` on every entry) is in `ROUTING.md` §Settings engine.

**Appearance paints from the first byte.** `org.user_preferences` gained `contrast` · `font` · `cvd` ·
`motion` (the theme column already existed). The durable copy is the row; the **`pj.a11y` cookie**
(`utils/a11y-context.ts`, not HttpOnly — it carries no authority) is its per-device mirror, read by
`routes/_middleware.ts` into `ctx.state.a11y` and written by `_app.tsx` onto `<html>`
(`data-contrast` · `data-font` · `data-cvd` · `data-motion`, plus `dir` — the document direction rides
the same cookie because a mirrored relayout after paint is a full reflow). Only overlays that are ON
become attributes, so the OS `prefers-contrast` / `prefers-reduced-motion` queries still apply under
`standard`. `hydrateConfigFromDom` reads those attributes back into the design-system store, so
hydration never repaints the defaults. A change applies in this order: the store (same frame) → the
cookie → `LocalKeys.A11Y_PREFERENCES` (a pre-paint script restores a cleared cookie from it) →
`PATCH /api/user/preferences`, whose response re-sets the cookie. The appearance columns are read and
written in statements of their own, never beside the display currency, so a database that predates
them degrades Appearance to "this device only" instead of breaking the currency switcher.

**Keyboard.** `/` focuses the settings search (modal and lane) unless the target is editable
(`shell/core/shortcuts.ts` `isFocusSearchShortcut`); Enter in the search opens the best match and
moves focus INTO it; the tree is `TreeNav` (one tab stop, arrows, Home/End). `Cmd/Ctrl+K` is left to
the command palette.

### Sessions & Google OAuth

- **Session cookies.** A successful sign-in (password grant, verified email OTP) returns the GoTrue
  tokens on the `ServiceResult.session` envelope — never in the JSON body. The route mints canonical
  HttpOnly cookies `sb-access-token` / `sb-refresh-token` (the names the `(dashboard)` middleware
  checks) via `apps/web/utils/auth-cookies.ts`, folded in by `toAuthResponse`. Islands `fetch` the
  route, the browser stores the cookies, and the island's `location.href` navigation is
  authenticated. Every builder takes the request (Decision #201). `Secure` is set in production,
  on an `https:` request, or when `X-Forwarded-Proto` reports `https` from a TLS-terminating
  proxy. Plain `http://localhost` stays insecure for development.
- **Session lifetime ("Keep me signed in").** `LoginSchema.remember` reaches
  `AuthBackendService.authenticate`, which stamps it on `SessionTokens.remember`. Remembered, the
  refresh cookie lives 30 days. Not remembered, it has no `Max-Age` and ends with the browser
  session, and an HttpOnly browser-session flag `pj_session_transient=1` is set beside it. A renewal
  leaves `remember` unset and inherits the flag, so the lifetime survives every refresh. A browser
  with no flag is a remembered session. Sign-out clears the flag.
- **Session lifecycle & silent refresh.** The access token is short-lived (~1h, GoTrue
  `expires_in`); the refresh token lives 30 days when remembered, or the browser session otherwise. A session must be **renewed**, not dropped, when
  the access cookie expires. The single renewal primitive is fat
  `AuthBackendService.refreshSession(refreshToken)` (live GoTrue `refreshSession({ refresh_token })`
  → rotated tokens; stub re-mints so the path is testable without a wired GoTrue — it grants no
  access, and is only reachable when a refresh cookie is actually presented). It feeds two consumers
  via `apps/web/utils/session.ts` `ensureSession(req)` — fast path (access cookie **verified**, see
  "Access-token verification" below) → **refresh-before-redirect** (access gone, or present but
  invalid or expired, + refresh present → renew in place; an invalid access cookie with no refresh
  cookie → clear both and bounce) → **fail-closed on a refusal only** (a refused grant — spent/revoked refresh token, GoTrue `400`/`401`/`403` → clear both
  cookies; an unreachable or failing GoTrue → `503`, cookies kept, so an outage never signs anyone out;
  `services/auth/refresh-outcome.ts`, Decision #193):
  - **Server (the `(dashboard)` guard).** `routes/(dashboard)/_middleware.ts` calls `ensureSession`,
    re-mints the renewed `sb-*` cookies onto the proceeding response, re-derives
    `ctx.state.userContext` from the fresh token (so a just-renewed request never paints guest
    chrome), and — only for a genuinely dead session — redirects to `/login` capturing the **full**
    target (`pathname + search`) as `redirectTo` for a loss-free return. When GoTrue cannot answer
    (`ensureSession` → `unavailable`) it throws a `503` instead: `_error.tsx` offers "Try again" on
    the same URL, and the cookies are kept.
  - **Client (the 401 interceptor).** `POST /api/auth/refresh` (thin, NOT behind the guard — it must
    be reachable when the access token has expired) renews the cookies via `toAuthResponse`; it
    answers `401` and clears the cookies only on a refused grant, `503` with the cookies kept
    otherwise. The shared `apps/web/utils/api-client.ts` `apiFetch()` wraps `fetch`: on a `401` it
    triggers a single shared refresh, retries the original request, and routes to
    `/login?redirectTo=<path>` only when the refresh answered `401` (a `503` or a dropped connection
    hands the original `401` back instead). Feature `api.ts` transports adopt it by swapping
    `fetch`→`apiFetch` (done for `features/projects/core/api.ts`).
  - **Claim-changing mutations re-issue the session themselves.** `POST /api/context/switch`,
    `POST /api/user/freelancer`, `POST /api/user/handle`, a freelancer-profile `POST`/`DELETE
    /api/user/lifecycle`, and a `PATCH /api/user/preferences` touching locale · display currency ·
    date format (`touchesTokenClaims`) change what the access-token hook stamps, so after a
    successful mutation the route renews the session server-side (`session.ts`
    `respondWithReissuedSession`, over `renewSession`) and mints the rotated cookies onto the same
    response. A failed renewal keeps the old cookies and answers `claimsStale: true`. The clients
    never call `/api/auth/refresh` themselves: `useContextSwitch` and `partner-service` report a
    stale answer and do not navigate; Settings says the old value may show for up to an hour (the
    access token's lifetime) and skips its reload. Any caller of these routes, not just the app's
    clients, leaves with fresh claims (Decision #193).

  See Decision #46.
- **Access-token verification (Decision #205).** The `sb-access-token` cookie is never trusted by
  presence. `AuthBackendService.verifyAccessToken(token)` checks it locally
  (`packages/backend/core/access-token.ts`): the key is chosen strictly by the token's `alg` —
  `ES256` / `RS256` against the project's public JWKS (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  matched by `kid`), `HS256` against `SUPABASE_JWT_SECRET` — then `exp` (30 s leeway), and a user
  session's claims (`sub`, `aud` `authenticated`, which refuses a legacy anon/service key). The local
  CLI stack signs `ES256`. The JWKS is cached 10 minutes; an unknown `kid` refetches at most once per
  30 s (rotation); a failed refetch keeps the keys already held; never having obtained them is an
  outage (`503`), not a verdict. `session.ts` `verifyAccessCookie` runs it once per request (a
  `WeakMap` on the `Request`), shared by the global middleware (`resolveRequestViewer`: a tampered or
  expired cookie paints guest chrome and `isAuthenticated: false`, so the auth-screen guard bounces
  only a valid session) and `ensureSession`. **Stub mode** — the auth backend not live, outside
  `DENO_ENV=production` — trusts presence (`verified: false`): `dev:mock` and stub sessions are opaque
  or hand-made tokens with no issuer to check. Production always verifies. **Residual:** local
  verification cannot see revocation — an access token whose session was revoked elsewhere (a global
  sign-out, a copied cookie) passes until its `exp` (≤ 1 h); its refresh token is dead, so the
  session ends there, and RLS remains the backstop for data in between.
- **Sign-out & the account projection (Decision #47).** `AuthService.logout()` →
  `POST /api/auth/logout` (thin) → fat `AuthBackendService.signOut(accessToken)` (live: best-effort
  GoTrue **global** revocation; stub: no-op) → the route **unconditionally clears** both `sb-*`
  cookies (`sessionClearCookies`). Cookie clearing is the authoritative sign-out; revocation is
  defence-in-depth, so a failed revocation never blocks logout. The header `UserActions` island then
  applies a **route-aware redirect**: a protected `(dashboard)` route leaves for the public landing
  (`/`); a public route reloads in place as a guest — the route GROUP that renders the shell is the
  public/protected source of truth (threaded `protectedRoute` → `UserShell` → `UserActions`, set
  only by the `(dashboard)` layout). The account popover binds **live account data** via
  `GET /api/user/me` (thin) → fat `services/user/UserBackendService.me({ context, accessToken })`,
  which composes the chrome `UserContext` (role badge + active workspace) with the live Supabase
  `auth.users` identity (name / email / avatar via `auth.getUser`), degrading to the context
  projection when the live read is unavailable (it only 401s a genuine guest). Shape: the Zod SSOT
  **`@projective/types/user`** (`CurrentUser`, `resolveAccountRole`). The thin client
  `AccountService.current()` is chrome-safe — a failed load resolves to `null` (→ the SSR-hydrated
  context fallback), never a sign-in redirect. In an entity context `workspace.name` is the entity's
  display name, read through `org.get_acting_context_details` (which answers only for an entity the
  caller holds an active seat in — an RLS read could not see `org.business_profiles`, which has no
  client SELECT policy, so a business showed its slug; Decision #150), falling back to its slug. A second read, `GET /api/user/setup` → `UserBackendService.setup`, returns the
  PERSON's `AccountSetup`: the setup PROGRESS, the verification stamp, the published working hours
  and the Standing rung, composed from `org.get_party_cards` → `org.get_profile_view` (stamp · hours
  · standing) and `UserBackendService.getSetupProgress` (`services/user/setup-progress.ts`) →
  `org.fn_compute_profile_setup_progress`. **The completeness rule lives in that SQL function
  alone** (Decision #155, reversing #149(A)'s TypeScript rule): weights account 20 · email 10 ·
  skills/interests 10 — the 40 a finished sign-up reads — then photo 20 · headline + story 20 ·
  published hours 20, plus the single `next_suggested_action` (a seller's KYC and payout first). The
  popover only names and routes what it answered (`shell/core/account-setup.ts`); at 100% the
  percentage gives way to the verification status, and the next action is one filled call to action
  (`AccountSetupNudge`). Unreadable → `setup: null` → no ring.
- **Milestone celebrations (Decision #155).** A verification stamp landing or setup reaching 100% is
  celebrated IN PLACE, never with a blocking modal: the popover publishes the setup it renders
  (`shell/core/milestones.ts` · `accountSetupSnapshot`), the `MilestoneCelebration` island (mounted
  by `UserShell`) compares it with the last mark this device saw (`LocalKeys.SEEN_MILESTONES`) and,
  on a raise, plays a one-shot stamp (`transform: scale()` on `--spring-snappy`, none under either
  reduced-motion channel) on the header ring and the popover crest, plus one transient `Toast` that
  states only what the milestone unlocks. A first visit records the baseline and celebrates nothing.
- **Trust signals (Decision #155).** `org.get_profile_view` carries `verification_stamp` and a
  seller's `adornments`; `mapProfileView` (`services/profile/live-profile.ts`) ranks them with
  `rankAdornments` and caps them at `PUBLIC_ADORNMENT_LIMIT` (3) before they reach `ProfileView`.
  Both are written only by definers in the Standing sweep and the KYC/payout trigger
  (`database/org/Functions.md` §Trust signals).
- **Proposal allowance (Decision #154).** One caller-scoped definer, `finance.get_proposal_allowance`,
  is the only door: it derives the subject from `auth.uid()` (or an active team membership), so
  `finance.fn_current_allowance` — which takes ANY subject id — stays service-role. `GET
  /api/user/allowance` (thin) → `WalletBackendService.getProposalAllowanceStatus` (logic in
  `services/finance/proposal-allowance.ts`, an in-memory twin with finance off) →
  `resolveProposalAllowance` (`@projective/types/finance`), which owns the one refusal rule: the
  metered reasons refuse only while `proposal_allowance_enforced` is on, the eligibility reasons
  (no `bind_seat`, an unpublished team, a team under two members — `projects.fn_assert_team_can_apply`'s
  order, Decision #228 (E)) always. `ProjectBackendService.apply` runs the same read as
  a **pre-flight gate** for the subject the application will be metered against and, when it refuses,
  records `entitlement.denied` through `finance.record_proposal_denial` — the app-layer emission
  #58 called for, since the insert trigger never runs. A gate read that FAILS lets the application
  through; the trigger still meters and, when enforced, still refuses. On the client, one module-level
  store (`features/proposals/core/allowance-state.ts`) feeds the popover meter, the lane disclosure,
  the apply modal and the `/projects` proposal list, so a write re-reads it once and every meter
  moves with no reload; countdowns are measured on the server's clock (`serverNow` + the receipt
  skew), and the Dev Context Switcher's `proposalAllowance` axis is applied there, client-side only.
- **Persona unlock ("Become a Partner").** `/become-partner` → `POST /api/user/freelancer` (thin,
  `EnableFreelancerInputSchema`) → `UserBackendService.enableFreelancer` →
  `org.enable_freelancer_profile` in the caller's JWT, which creates the freelancer profile with its
  starter skills, flips `is_freelancer`, and switches the acting context to the freelancer persona
  through `security.fn_set_session_context` (clearing any team or enterprise slot). The claims
  then lag the database exactly as after a context switch, so the route re-issues the session on
  the same response (the hook re-mints `active_context.isFreelancer`; Decision #193) and the client
  hard-navigates to `/[handle]/edit` so the server-painted chrome (sidebar Services/Teams, the
  Create menu's seller items, the popover's role) re-derives from the new token. A `claimsStale`
  answer is reported, never navigated past (Decision #150).
- **Google OAuth (PKCE).** `/api/auth/oauth/google` begins the Supabase handshake and persists the
  PKCE **code-verifier** in a short-lived cookie (a `CookieStore` storage adapter on the anon
  client); `/api/auth/callback` exchanges the `code` for a session, mints the `sb-*` cookies, clears
  the verifier, and routes — a **new** Google identity (no `org.users_public` yet) to `/join`
  pre-filled to finish onboarding via `complete_onboarding`, an existing user to their return path.
  `/join` is only for a **confirmed** brand-new identity: a `users_public` lookup failure defaults
  to _existing_ (route to the return path), so a transient error never re-onboards a returning user
  (Decision #46). All gated by `AUTH_BACKEND_LIVE`; non-live, the start route simulates the
  pre-filled-`/join` branch.
- **Enterprise SSO (SAML/OIDC).** `/api/auth/sso` calls `signInWithSSO({ domain })`; a resolved
  provider returns an IdP authorize URL that the login panel navigates to (carried as the external
  `AuthResult.ssoUrl`, distinct from the same-origin `redirectTo`). SSO reuses the OAuth PKCE
  machinery — the verifier cookie is set on the POST response and the IdP → GoTrue → **the same
  `/api/auth/callback`** completes the exchange. Enabling SAML needs `[auth.sso.saml]` +
  `SAML_PRIVATE_KEY` and a per-domain provider registered via the CLI (see `supabase/config.toml`);
  with none configured the panel shows a friendly "no provider" note.
- **Corporate-domain member signal.** On a standard (email/password) individual signup,
  `AuthBackendService.provisionAccount` fires a best-effort, non-blocking check: if the new
  address's domain matches an existing `org.enterprises` registered domain (`website`, normalised
  — scheme / `www.` / path stripped; sub-domains match), it inserts a `comms.notifications` row
  (`type: "enterprise.domain_member_signup"`) for that enterprise's active **owners/admins** so they can
  invite or approve the colleague. No new schema — it reuses `comms.notifications` + the org
  membership join. Gated by `AUTH_BACKEND_LIVE` (non-live: no-op); any failure is swallowed so it
  can never fail account creation. OAuth completions are excluded (only inbound email
  registrations).

---

## Database

The Projective database layer is built on PostgreSQL via Supabase, emphasizing Row-Level Security
(RLS), high-performance vector search, and a strict quarantine-based storage lifecycle.

### Migrations

Migration files follow a strictly categorized numbering system to ensure predictable deployment and
prevent schema conflicts. Each range represents a specific layer of the database architecture:

- **0000 - 0099: Core Structure** (Enums, Schemas, Tables).
- **0100 - 0199: Logic Layer** (Functions, Stored Procedures, RPCs).
- **0200 - 0299: Security Layer** (RLS Policies, User Permissions).
- **0300 - 0399: Analytics Layer** (Views, Materialized Views).
- **0400+: Data Layer** (Seed data, initial population, lookups).

Remeber to utilise indexes and other PostgresQl features.

While in MVP development these can be edited manually.

### Searching & Recommender System

To achieve low-latency, high-relevance search, we utilize a **Triggered Search Table** pattern
combined with `pgvector`.

#### Search Architecture

- **Performance:** We avoid searching across complex JOIN views. Instead, dedicated search tables
  are populated via DB triggers whenever source records change.
- **Vector Encoding:** `pgvector` columns hold Voyage AI `voyage-4` embeddings — 1024 dimensions,
  unit length, so the HNSW indexes use `vector_ip_ops` and inner product ranks as cosine (Decision
  #179). Every public discovery entity has one, in `search.profiles_index` · `projects_index` ·
  `services_index` · `catalogue_index` (products and articles). **Write path:** `deno task
  embeddings:backfill` and the post-commit re-embed → `search.fn_set_embedding` (service role only),
  skipping a text whose SHA-256 and model are unchanged. **Read path:** `search.fn_nearest` (a query
  vector) and `search.fn_nearest_to_entity` (an item's stored vector) answer ids and scores over public
  rows; `anon` and `authenticated` cannot select a vector column. **Gate:** `isEmbeddingsLive(req?)` —
  see §Discovery (Explore) services.
- **Context-Aware Ranking:** The recommender system performs weighted vector similarity searches
  taking into account:
  - **User Context:** Preferences, interaction history, and search history.
  - **Work Context:** Project descriptions, budget constraints, and current freelancer workloads.
  - **Professional Context:** Freelancer headlines, project history, and desired budget.

### Storage Lifecycle

All file uploads follow a "Quarantine-First" protocol to protect the platform from malware and
viruses.

1. **Ingestion:** Files are initially uploaded to a `quarantine` bucket via a signed upload URL,
   under the uploader's own id prefix.
2. **Validation:** The fat media service (service role) claims the row, sniffs the magic bytes and
   fully decodes the file (see §Backend Services → The Public Profile). A third-party **malware**
   scan by a security provider is the planned addition to this step and is not yet wired.
3. **Promotion:** A file that passes is admitted to its destination (a person's private library in
   `personal`, with its WebP tiers) and the database record is updated; a public copy only ever
   reaches `avatars` / `showcase` as a pipeline-cut rendition. A file that fails is deleted from
   quarantine and its row marked `quarantined` (a hostile file) or `error`.
4. **Publication gate (planned, Decision #148):** before any object is written to a **public**
   bucket (`avatars`, `showcase`, `catalogue`, `public_assets`), the moderation classifier must
   return a clean verdict. The gate sits at publication, not in quarantine: a quarantined upload
   always lands in a **private** library first, and screening there would scan the private zone the
   Two-Zone model exempts. See §Backend Services → Content moderation.

### Scheduled jobs (pg_cron + pg_net, Decision #203)

Every recurring job is one row of **`ops.scheduled_jobs`**, seeded by
`supabase/migrations/00005060_seed_scheduled_jobs.sql`. That row is the only place a cadence is
set: an `INSERT`, `UPDATE` or `enabled = false` on it schedules, reschedules or unschedules the
pg_cron job in the same transaction (`ops.tg_scheduled_jobs_apply`), and an invalid cron expression
is refused with the write. The seed sets the default on every reset; on a running database change
it in SQL:

```sql
UPDATE ops.scheduled_jobs SET schedule = '30 * * * *' WHERE name = 'finance-recurring-deposits';
UPDATE ops.scheduled_jobs SET enabled = false WHERE name = 'account-erasures';  -- pause
```

- **Two kinds.** A `sql` job runs its single `SELECT` in the database as the pg_cron owner. An
  `http` job calls `ops.fn_dispatch_http_job`, which POSTs to `CRON_APP_URL` + the row's `path`
  through **pg_net** with `Authorization: Bearer <secret>`. Both values are read from **Supabase
  Vault**, never from a migration. The bearer's Vault name is the row's `secret_name`, the same
  key the app reads from its env, so the route and the dispatcher compare one value from two stores.
  A route keeps its own guard (404 unless the bearer matches, Decision #125), so the jobs are safe to
  call more often than scheduled. An http job's batch size is the `limit` in its `path`.
- **Nothing is silent.** Every skip and failure raises a `WARNING` and writes an
  `ops.log_entries` row with `scope = 'ops.scheduler'` and `client_id = 'scheduler:<job>:<reason>'`:
  - `pg_cron_unavailable`, `schedule_failed` — at registration (`ops.fn_schedule_job`);
  - `pg_net_unavailable`, `vault_unavailable`, `app_url_missing`, `secret_missing` — at
    dispatch, at most one row a day per job and reason;
  - `dispatch_failed`, `http_failed` (non-2xx, transport error or timeout), `no_response`;
  - `run_failed` — a sql job that raised (read from `cron.job_run_details`, once per run).
  pg_net answers asynchronously and keeps a response for 6 hours, so every dispatch is recorded in
  `ops.http_job_dispatches`, and `ops-watch-jobs` copies each outcome there and logs the failures
  together with the failed pg_cron runs. `00000002` also warns when it cannot create pg_cron or pg_net, but the `ops` tables
  do not exist yet at that point, so that skip is logged per job by the seed.
- **Run any job by hand:** `deno task cron:run <job>` (`--list` prints the registry). A sql job runs
  through `ops.run_job` (service role only). An http job is POSTed to `APP_URL` + its path with the
  bearer from `.env.local`, exactly as the scheduler sends it, so the app must be running. This is
  also the path for a database without pg_cron.
- **Environments.** The Supabase Postgres image ships pg_cron, pg_net and Vault, local
  `supabase start` included (measured 2026-10-13: pg_cron 1.6.4, pg_net 0.20.4), so every sql job
  runs locally as it does when hosted. The http jobs skip (and log) until the Vault secrets below
  exist. Locally `CRON_APP_URL` is `http://host.docker.internal:<PORT>`, because pg_net runs
  inside the database container.

| Job                               | Cadence (UTC)       | Runs                                                                   | Owner                                                    | Idempotency                                                                                                         |
| :-------------------------------- | :------------------ | :--------------------------------------------------------------------- | :------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| `analytics-listing-rollups`       | daily 02:10         | `analytics.fn_rollup_listings(current_date - 1)`                       | Catalogue — listing analytics (`00001600`, Decision #218) | Upserts the day on the rollup key and deletes the day's listing rows it no longer produces, so a re-run (or `analytics.fn_backfill_listing_rollups`) rewrites the day to one fresh computation. |
| `finance-billing-cycle`           | daily 02:20         | `finance.fn_run_billing_cycle()`                                       | Finance — billing (`00001250`)                           | One invoice per business per billing day and one statement per wallet per month; a missed day is caught up, a re-run adds nothing. |
| `archive-stale-service-drafts`    | daily 03:10         | `projects.fn_archive_stale_service_drafts()`                           | Projects — service pipeline (`00001130`)                 | Archives only `draft` rows still idle with no funded stage; never deletes.                                         |
| `finance-reconcile-wallets`       | daily 03:40         | `finance.fn_reconcile_wallets()`                                       | Finance — ledger (Decision #186)                         | Read-only on finance; a persisting drift is re-reported each run (one ops row per drifted wallet).                  |
| `finance-mature-pending-releases` | hourly :05          | `finance.fn_mature_pending_releases()`                                 | Finance — pending window (Decision #191)                 | `FOR UPDATE SKIP LOCKED` batches; a matured row is closed and never credited twice.                                 |
| `auto-release-session-escrow`     | every 15 min        | `finance.auto_release_session_escrow()`                                | Sessions & cohorts (`00001155`, Decisions #171 / #211)   | State-gated: only `scheduled` sittings complete and only `held` escrows move — a 1-1 sitting's own escrow 24h after it, a cohort seat's after the last sitting, never under an open dispute. |
| `session-scheduling-handshakes`   | :07 / :22 / :37 / :52 | `projects.fn_lapse_session_handshakes()`                             | Sessions — set-session blocks (`00001155`, Decision #211) | One reminder per booking (the notification row is the mark); a round is closed once (`close_reschedule_round` answers NULL for a closed round). |
| `finance-dispute-sweep`           | :07 / :22 / :37 / :52 | `finance.sweep_disputes()`                                           | Finance — platform disputes (`00001260`, Decision #212)  | Each case is locked and re-checked by the function it is handed to: a settled escrow closes its dispute once, an `open` claim is audited once its sitting ends, an `awaiting_response` case past `respond_by` escalates once (`dispute.escalated`, stamping the review SLA `review_by`); an `under_review` case past `review_by` is never ruled — it writes one `ops.log_entries` `warn` row and notifies every operator (`dispute.review_overdue`) at most once a day per case (`review_alerted_at`). |
| `finance-sweep-stale-payouts`     | every 10 min        | `POST /api/finance/cron/payouts?limit=50` · `FINANCE_CRON_SECRET`      | Finance — `PaymentBackendService.sweepStalePayouts`      | Each payout is leased once per window (`finance.fn_claim_stale_payouts`, `SKIP LOCKED`); every transfer carries its payout's Stripe idempotency key. Seeded only where the claim function exists (Decision #202). |
| `finance-recurring-deposits`      | hourly :15          | `POST /api/finance/cron/deposits?limit=50` · `FINANCE_CRON_SECRET`     | Finance — `PaymentBackendService.processDueDeposits`     | A period is claimed once (`finance.claim_due_deposit_rules`) and each charge carries a Stripe idempotency key; a run left unbound by a transient failure is re-sent by the next sweep under the same key (≤ 23 h). |
| `scheduling-availability-horizon` | daily 03:05         | `POST /api/scheduling/cron/horizon?limit=200` · `SCHEDULING_CRON_SECRET` | Scheduling — `ScheduleBackendService.extendHorizons` (#217) | Recompiles each live preset not compiled, or compiled through an earlier date than today + 90 d, over today → today + 120 d; a recompile replaces the window it covers (`replace_preset_occurrences`), so a re-run rewrites the same spans. A failed preset is logged and retried next run. |
| `contact-attachment-sweep`        | hourly :25          | `POST /api/contact/cron/attachments?limit=100` · `CONTACT_CRON_SECRET` | Contact — `ContactBackendService.sweepAttachments` (#276) | Each unsent contact upload older than 6 h is claimed once (`ops.fn_claim_stale_contact_attachments` soft-deletes it, `SKIP LOCKED`, so a file a submission or a Remove holds is skipped) and its object deleted through the Storage API; an object that fails to delete is logged — its row is already gone from every reader. |
| `account-erasures`                | daily 04:10         | `POST /api/user/cron/erasures?limit=100` · `ACCOUNT_CRON_SECRET`       | Account — `AccountLifecycleBackendService.sweepDue` (#156) | A request completes once; one whose blockers came back is deferred, not forced.                                     |
| `ops-watch-jobs`                  | every 10 min        | `ops.fn_watch_jobs()`                                                  | Ops — the registry itself                                | `SKIP LOCKED`; a dispatch is settled (and reported) once, a failed run is reported once (keyed by run id).          |

`finance-reconcile-wallets` and `finance-mature-pending-releases` are seeded only where their
function exists (M3 / M4 reached `main` separately), so the seed holds whichever order they land in.

**Implemented but not registered (Decision #203 flag (a), awaiting a human):** the comms engine's
`fn_process_queue`, `fn_escalate_unread`, `fn_build_digests` (daily and weekly), `fn_sweep_expired`,
`fn_reap_dead_devices` and `fn_compact_delivery_events` (their intended cadences are in `database/comms/Functions.md`), and
`projects.fn_release_expired_claims` and `projects.fn_resolve_expired_workload_reports`. No
migration has ever scheduled them. Each is one registry row once its go-live is decided.

### Edge Functions & Webhooks

Edge Functions act as the serverless orchestration layer for the platform, handling event-driven
logic and external integrations.

#### Core Functions

- **Virus Scanning:** Automated scanning of quarantined storage files.
- **Notifications:** Triggering push notifications, emails, or internal alerts based on database
  webhooks (e.g., a new project bid).
- **Background Tasks:** Handling heavy processing that exceeds the standard request-response timeout
  of Fresh routes.

#### Webhook Standards

- **Authenticity:** All incoming webhooks must verify signatures (e.g., from Stripe or Supabase)
  before processing.
- **Idempotency:** Functions must be designed to handle duplicate events without corrupting data or
  double-sending notifications.

### The Notification Engine

Migrations `20260724090000`–`20260724094000`. Zod SSOT `@projective/types/comms`; schema reference
[`database/comms/`](../database/comms/Tables.md).

**Routing policy is data, not code.** `comms.notification_types` holds one row per event key
(94 seeded) declaring its category, urgency, default channel fan-out, mute-ability, quiet-hours
override, dedupe window and audit flag. `comms.fn_resolve_channels` intersects that with the
recipient's global / per-category / per-type preferences, their quiet hours and their digest cadence.
Adding an event is a catalog row, not a code change in every emit site.

```
Event (RPC / trigger / cron)
  └─ comms.fn_notify ─┬─ INSERT comms.notifications ──► Supabase Realtime      (in-app)
                      ├─ INSERT comms.notification_deliveries (per channel/device)
                      │     └─ AFTER INSERT trigger ──► dispatch Edge Function (push · email · SMS)
                      └─ security.audit_logs                                    (financial/security events)
pg_cron ─ fn_process_queue · fn_escalate_unread · fn_build_digests · sweeps   (not registered yet — §Scheduled jobs)
```

**Boundaries that matter:**

- **The engine never raises.** `fn_notify` is invoked from inside escrow and stage RPCs; its body is
  wrapped so a notification problem can never roll back a money movement.
- **A row is always written; delivery is separate.** `comms.notifications.channels` records what the
  router decided — an empty array means "recorded, delivered nowhere". The in-app inbox reads the
  `comms.notification_feed` view, which filters on `in_app` membership.
- **Clients cannot write notifications.** There is no `INSERT` policy; rows come from the
  SECURITY DEFINER writer or the service role, so _"Payout sent"_ cannot be spoofed. The only client
  write is flipping read/seen/archived on your own row — a column-scoped `UPDATE` grant
  (`00002520` §2), since an own-row policy cannot stop a rewrite of the row's title or link. The app
  goes through the inbox RPCs via `NotificationInboxBackendService` (`/api/notifications/*`).
- **The app does not subscribe to Realtime for the inbox.** The header drawer and `/notifications`
  poll `/api/notifications/summary` (30 s, visible tabs only, one poller per page) and re-read the
  list head when it rises — Decision #173. The table stays in the Realtime publication for any
  future server-side consumer.
- **`mandatory` types bypass preferences entirely** — security, money-movement, legal and moderation
  events are not suppressible, and a `marketing_only` unsubscribe can never silence them.
- **Webhook idempotency is a unique index.** `comms.delivery_events (provider, provider_event_id)`
  is the concrete implementation of the standard above: a replayed gateway callback can never
  double-apply. Its row is never deleted — only its `raw` body is compacted after 30 days.
- **Deferred work is durable and cancellable.** `comms.notification_queue` holds promises of future
  notifications (session T-60/T-15/T-5 reminders, abandoned-basket nudges, ghosting/auto-approve
  timers) keyed by a deterministic `dedupe_key`, so re-running a scheduler is a no-op and the event
  that invalidates a reminder cancels it by key.

**Where people change it.** Settings → Notifications edits preferences through `GET`/`PUT
/api/user/notifications` (`NotificationCenterBackendService`, caller's JWT). Because the router reads
`COALESCE(category, global)`, a channel MASTER is saved together with a `resetChannels` entry that
sets that channel back to `null` on every category row — otherwise an older per-category value would
outrank the master. Mandatory catalog types are shown as locked "always on" rows summarised from the
catalog (`RequiredAlerts`), never as switches. Settings → Messaging writes the same
`notification_prefs` row (receipts, typing, sound, away replies) through `POST /api/messaging/settings`;
quiet hours and the global pause are edited only under Notifications, so one column has one editor.

**Away replies are sent by the database (Decision #156).** `comms.tg_dm_auto_reply` (`AFTER INSERT ON
comms.dm_messages`) answers a human message in a one-to-one thread with the recipient's best matching
`comms.auto_responses` rule — keyword, named service, hiring invitation, any service inquiry, a status,
then a first-contact greeting — at most once per rule per thread per day, inside the rule's optional
window, marking the reply `auto_response_id` so it never answers itself or accepts a request. Statuses
are derived (`comms.fn_auto_reply_status`): away = notifications paused, busy = in a calendar event or
blackout, out of hours = outside published working hours, holiday = the rule's own dates. A failure is a
`WARNING`, never the loss of the person's message.

**Still to build (not in the database layer):** the `dispatch-push` / `send-email` Edge Functions and
their provider credentials (VAPID keypair, FCM/APNs, an SMTP or email-provider block in
`config.toml`). The outbound trigger is feature-flagged **off** with an `XXXX-XXXX` placeholder URL
until they exist.

---

## Security

Projective employs a multi-layered security architecture designed to enforce data isolation and
runtime integrity. By combining Deno's native sandboxing with PostgreSQL's Row-Level Security, we
ensure that security is not an afterthought but a core architectural constraint.

### Authentication & Authorization

The platform utilizes Supabase Auth for identity management, integrated directly into the Fresh
request lifecycle.

- **Auth Guards:** The global `routes/_middleware.ts` verifies the session JWT (signature, expiry,
  session claims) before any handler runs and resolves a tampered or expired one to a guest; the
  `(dashboard)` guard admits only a verified session, renewing or clearing the rest (§Sessions,
  "Access-token verification", Decision #205).
- **Role-Based Access Control (RBAC):** Permissions are checked at the Service layer using custom
  claims within the JWT (e.g., the acting context's `role`), ensuring that "Projective" users can
  only access resources within the entities they are authorised for.
- **Session Integrity:** We use secure, HTTP-only cookies for session persistence to mitigate
  XSS-based token theft.

### Row-Level Security (RLS)

RLS is mandatory for all database tables to prevent cross-tenant data leakage.

- **Tenant Isolation:** Every table containing user or entity data includes an
  owning-entity id or `user_id` column.
- **Policies:** Migration series `0200_org_rls.sql` defines strict `USING` and `WITH CHECK` clauses
  that verify the user's `auth.uid()` or an acting-context claim in `auth.jwt()` matches the row data.
- **Bypassing:** Only the service-role key (used within authenticated Edge Functions) can bypass RLS
  for administrative tasks like file scanning.

### Function `EXECUTE` grants (deny by default)

Every schema in `supabase/config.toml` `[api].schemas` is an RPC surface: PostgREST serves any
function a role may execute at `/rpc/<name>`. Postgres grants `EXECUTE` to `PUBLIC` on every new
function, and Supabase additionally grants every `postgres`-created function in `public` to `anon`
and `authenticated`, so an ungranted `SECURITY DEFINER` is a door anybody can open, signed out
included.

- **Deny by default.** `00002510_permissions_function_grants.sql` revokes `EXECUTE` schema-wide at
  the top of the file, before any per-function statement: `org` (from `PUBLIC`, `anon`,
  `authenticated`), `projects` (from `PUBLIC`, `anon`), `public` (from `PUBLIC`, `anon`,
  `authenticated` on every function that is not an extension member), `finance` later in the file,
  and `editorial` and `community` (from `PUBLIC`, `anon`, `authenticated` — the mid-file
  "editorial + community — deny by default" block, Decision #274). `service_role` keeps them all. A
  client role then reaches a function only where it is **granted by name**.
- **What gets a grant.** `authenticated`: a door the app calls with the user's JWT, which resolves
  the caller from `auth.uid()` and checks its own authority. `anon`: a guest read the public site
  needs (e.g. `projects.get_cohort_offer`). Both client roles: a predicate an RLS policy calls,
  because a policy expression runs as the invoking role (`projects.has_project_access`,
  `org.is_active_team_member`, …). Nothing else: an internal helper, a primitive that trusts its
  arguments (`projects.fn_assign_ticket_core`, `public.provision_user_profile`, the ledger
  primitives) or a trigger function gets no client grant. Its definer callers run it as its owner.
- **A new function is unreachable until granted.** The schema-wide revokes run after every function
  exists, on every `supabase db reset`. They do not cover a function created afterwards: PUBLIC's
  `EXECUTE` comes from the global default privileges, which no per-schema `ALTER DEFAULT PRIVILEGES`
  can revoke. Add any new function to the consolidated `00001xxx` files, never after `00002510`.
- **Pinned `search_path`.** A `SECURITY DEFINER` sets `search_path` (`''` or an explicit list of the
  schemas it reads), so a caller's `search_path` cannot redirect an unqualified name. Every definer
  in every exposed schema does, except `security.is_admin()`.
- **An INVOKER calling a revoked function fails.** Its body, and an INVOKER trigger's, runs as the
  invoking role, so a call it makes to a revoked function raises `permission denied` for that role.
  Make the caller a definer rather than granting the callee (see `security.fn_slug_guard`).
- **Verified by** `supabase/probes/function_grants.sql`: no app-owned function in `projects` or
  `public` is executable by `PUBLIC`; no client role can execute `provision_user_profile` or the
  claim core; `projects.claim_ticket` is a self-claim for a project participant; every definer in
  both schemas pins its `search_path`; extension operators stay executable.

### Runtime & API Security

Deno 2.x provides a hardened environment that we strictly configure through permission manifests.

- **Sandboxing:** Our `deno.json` and task runners explicitly define permissions (e.g.,
  `--allow-net`, `--allow-env`). We never use `--allow-all` in production.
- **Input Validation:** Every API route handler uses Zod schemas from `@projective/types` to parse
  and validate request bodies before calling any Service. This prevents SQL injection and malformed
  data from reaching the logic layer.
- **Content Security Policy (CSP):** every response gets one policy, built by the pure
  `apps/web/utils/csp.ts` and set by the global `routes/_middleware.ts` (only when the response has
  none of its own). Third-party origins are exactly the ones a page talks to: **Stripe** —
  `script-src` `js.stripe.com` + `*.js.stripe.com` (the versioned `dahlia` Stripe.js, loaded on demand
  by `features/payments/core/stripe-js.ts`, never in every page's head), `frame-src` the same plus
  `hooks.stripe.com` (the Payment Element and 3-D Secure challenges), `connect-src api.stripe.com`;
  **Supabase** — the public storage origin (`SUPABASE_PUBLIC_URL`, else `SUPABASE_URL`) on
  `img-src`/`media-src`/`connect-src`, which is `http://127.0.0.1:54321` locally; and the no-cookie
  YouTube frame. `object-src 'none'`, `frame-ancestors 'none'`, `base-uri`/`form-action 'self'`, and
  `upgrade-insecure-requests` outside development. The policy is built on the FIRST request, not at
  import — the Supabase origin comes from `.env`, which is loaded after the module graph (built at
  import it silently blocked every local storage image). **`'unsafe-inline'` remains on `script-src`
  and `style-src`** (Fresh 2's inline bootstrap and the theme pre-paint carry no nonce; the design
  system writes custom properties through `style`); a nonce-based policy is a separate change
  (§8 Decision #126). There is **no `'unsafe-eval'`**: the client entry's first import
  (`utils/zod-jitless.ts`) puts Zod 4 in `jitless` mode, because its `new Function` eval probe — run
  as the first `z.object` is built — otherwise reported a `securitypolicyviolation` on every hydrated
  page. The header is cached per **profile** (`cspHeaderFor(profile)`): `app` is the
  policy above, set by the middleware; **`inspector`** is the same policy plus `'wasm-unsafe-eval'` in
  `script-src` (WebAssembly compilation only — pdf.js image decoders, Draco / Basis / meshopt — never
  JS `eval`) and `blob:` in `connect-src` (a GLB's embedded textures), and nothing else. Only the
  `/inspect/[fileId]` page sends it, on its own response, which the middleware then leaves alone.
  It is the one sanctioned LOOSENING of the platform policy — every other route may only tighten —
  and is flagged against #126 in Decision #161(D). `x-frame-options: DENY`, `object-src 'none'` and
  `frame-ancestors 'none'` still hold there, which is why a PDF is drawn on a canvas, never framed.
  The second sanctioned loosening is **`framed`** (Decision #217 (j)): the platform policy with
  `frame-ancestors 'self'` and nothing else changed. It is sent only by the catalogue's buyer
  simulation, `/catalogue/[id]/simulate`, on every one of its answers (the 404 too), because the item
  workspace's Preview tab frames that page. The middleware pairs it with `x-frame-options:
  SAMEORIGIN` (`frameOptionsFor`), and only when the response's policy is EXACTLY the `framed`
  header. Every other response, a route-written `frame-ancestors 'self'` included, still gets
  `DENY`, so a route cannot earn framing by writing a header of its own. Inside the frame, a link
  that leaves the simulation opens in a new tab (`PreviewFrameBridge`). Every other page still
  refuses to be framed.
  The streaming proxy's non-inline-safe responses carry their own `default-src 'none'; sandbox`.
- **Secrets Management:** Sensitive keys (Stripe API, AWS keys) are stored in **Supabase Vault** and
  accessed via environment variables in Edge Functions, never hardcoded in the repository.

### Cryptography & WASM Integrity

For high-sensitivity operations, we utilize the `@projective/wasm` package for client-side
cryptographic tasks.

- **SubtleCrypto Wrappers:** We provide a standard interface for AES-GCM encryption for private chat
  messages and sensitive attachments.
- **WASM Isolation:** Rust-compiled WASM modules provide a predictable, memory-safe execution
  environment for handling file decryption and sensitive hashing, minimizing the risk of
  memory-unsafe operations in the browser.

### Audit & Compliance

- **Logging:** All mutations (INSERT, UPDATE, DELETE) are captured via PostgreSQL Audit Triggers to
  a non-deletable audit log.
- **Edge Monitoring:** Webhooks and Edge Functions log their execution status and integrity checks
  to a centralized monitoring service.

### Authentication & Identity

Projective utilizes Supabase Auth as the primary identity provider, deeply integrated with
PostgreSQL RLS.

- **MVP Authentication:** The initial release strictly supports **Google OAuth** and standard
  Email/Password authentication. The password sign-in takes ONE identifier field that accepts an
  email **or** a `@handle` username: the thin route validates the shape (`LoginSchema.identifier`,
  the same `isIdentifier` predicate the form's instant check runs), and the fat
  `AuthBackendService.authenticate` tells the two apart and resolves a username to the account's
  email with a service-role read of `org.users_public` + the GoTrue identity before the password
  grant — the caller has no session yet, so an RLS-scoped read would show them nothing. An unknown
  username answers the SAME generic refusal as a wrong password (the form must not be a
  handle-enumeration oracle), and the `requiresVerification` branch returns the resolved `email` so
  a username sign-in can still reach `/verify`.
- **Email-confirmation poll (Decision #185):** `/verify` polls `GET /api/auth/verification-status`,
  which takes **no email**. `POST /api/auth/join` (and a password sign-in GoTrue refuses only for an
  unconfirmed email) sets `pj_pending_verification`: an HttpOnly, `SameSite=Strict`,
  `Path=/api/auth`, one-hour cookie holding `v1.<userId>.<exp>.<HMAC-SHA256>`
  (`packages/backend/core/pending-verification.ts`; key derived from `SUPABASE_SERVICE_ROLE_KEY`
  under a fixed label). The poll answers only for that user id, from GoTrue's `email_confirmed_at`
  (`auth.admin.getUserById`). No cookie, a forged, foreign or expired one, and a still-pending
  account all receive the identical `{ verified: false }`, and every poll is rate-limited (30 a
  minute per pending account, else per client address; 429). The poll never signs anyone in: a
  confirmed answer carries `signedIn` (whether the request holds a session), so the page continues
  in, or shows "Email confirmed — sign in" when the link was opened on another device. Resend and
  forgot-password were already uniform.
- **Extensibility:** The architecture must be built to support a unified integration model later. As
  traction builds, the platform will expand to include Microsoft (Azure AD), GitHub, and Apple SSO.
- **Database Sync:** A Supabase trigger automatically creates a corresponding public `users` profile
  record whenever a new identity is registered in the `auth.users` schema.
- **Transactional emails:** GoTrue sends branded, dual-path emails from `supabase/templates/` (wired
  in `config.toml` `[auth.email.template.*]`). The **confirmation** and **recovery** templates each
  surface the **6-digit OTP** (`{{ .Token }}`, `otp_length = 6`) _and_ a link, matching the
  `/verify` and `/forgot-password` "type the code or click the link" flows. Every URL hangs off
  `{{ .RedirectTo }}`, which `AuthBackendService` sets to the bare `APP_URL` origin (GoTrue
  substitutes `site_url`, also a bare origin, when it refuses one): the confirmation button opens
  `GET /api/auth/confirm?token_hash=…&type=email` (thin route → `confirmEmailLink` → `verifyOtp`,
  session cookies minted on the clicking device, `/home`; a spent link lands on
  `/login?notice=confirm_failed`), and the recovery button opens `/forgot-password?email=…&step=reset`
  on the code step. Design follows the design-system palette for seed `#288690` resolved to literal
  hex (no card: one column on the `--bg` tone, the code on a `--surface-2` tint, `--primary` /
  `--on-primary` button, semibold headings, `tabular-nums` code), responsive, dark-mode-aware
  (`prefers-color-scheme`), inline CSS + table layout with VML buttons for Outlook. The one image is
  the self-contained app-icon mark, `apps/web/static/email/logo-mark.png` (rendered from
  `static/logo.svg`), with an empty `alt` because the live-text wordmark follows it. Locally GoTrue
  fetches the bind-mounted templates from Kong's `:8088` server; a `kong reload` drops that server and GoTrue
  silently falls back to its default email (fix: `docker restart supabase_kong_<project_id>`).
  Mail lands in Mailpit (`http://127.0.0.1:54324`).
- **Secondary email addresses are verified by token, never by a column write** (Decision #151).
  `org.user_emails.verified_at` unlocks invitations sent to an address (`projects.project_invitations`,
  `org.fn_is_invitee`, `projects.invite_by_email`), so clients have SELECT only on the table and every
  write is a definer: `org.add_user_email` files it unverified; `security.issue_email_verification`
  (service role ONLY — so it never trusts a caller-supplied identity: the function takes an email id
  and mails the row's own address) mints a single-use 24-hour token
  and stores only its SHA-256; `org.confirm_user_email`, called by the signed-in owner holding the
  token, is the one path that stamps `verified_at`. An INVOKER guard trigger refuses any client-role
  change to `verified_at` · `email` · `is_primary` · `user_id` even if a policy is ever re-added. The
  sign-in address is still confirmed by GoTrue (`public.handle_email_confirmed`). The link leaves
  through `packages/backend/services/mail/verification-mailer.ts` — see the Environment Variable
  Contract for its no-transport behaviour.
- **Age guardrails are enforced in Postgres (Decision #190).** PRODUCT_SPEC §Age guardrails holds on
  every path, not only `/join`: `public.provision_user_profile` runs `org.fn_check_dob` before any
  write, so an under-13 date of birth is refused (`PM422`) whether it arrives through
  `POST /api/auth/join`, a direct GoTrue sign-up (`handle_new_user` aborts the sign-up) or
  `public.complete_onboarding`, and `trg_users_public_dob_guard` + `users_public_dob_check` keep
  every later `dob` plausible. The 13–17 **restriction is derived, never stored**:
  `org.fn_is_minor(uid)` reads `dob` at every call, so it lifts on the 18th birthday with nothing to
  run. One gate, `org.fn_assert_adult`, raises `PM403` in every buy/sell door — become-partner,
  apply, accept (the applicant), ticket assignment, listing publish (a trigger on
  `catalogue.listings`), wallet and on-account orders, card payments, `fund_*` and payouts. The
  access-token hook stamps `active_context.isRestricted` (`UserContext.restricted`, chrome only).
  The API routes mirror the gate with `refuseIfRestricted` (`apps/web/utils/age-gate.ts`) and the
  services map `PM403` through `packages/backend/core/age-gate.ts`, so both answer the same 403
  (`RESTRICTED_REFUSAL`, reason `age_restricted`). The `/join` body is the
  `@projective/types/auth` `JoinSchema`, which refuses an under-13 or implausible `dob` with the
  form's own copy; a client-sent `restricted` flag is stripped and never read. The Dev Context
  Switcher's **Age** axis drives the mirror through the `pj.dev.age` cookie, honoured only when
  `DENO_ENV` is `development`.
- **Teams are freelancer-only (Decision #228 (A)).** One predicate, `canUseTeams`
  (`apps/web/features/shell/core/restricted-surfaces.ts`): a freelancer outside operator mode, or a
  member acting as a team, never a restricted account. It gates the Teams rail entry (`globalNav`),
  Create Team (`createMenuOptions`), the account popover's Teams section, and `/teams*` in the
  `(dashboard)` guard, which sends a refused request `303` to `/home?notice=teams-freelancer` (the
  restricted-surface fallback; `ProjectNoticeHost` on `/home` says it once). It reads
  `UserContext.isOperator`, which the access-token hook stamps from `users_public.is_operator`. The
  database refuses on its own: `org.fn_assert_team_persona` (`PK403 persona_not_freelancer`) in
  `create_workspace`, `invite_workspace_member` (by handle), `respond_to_workspace_invitation` and
  `transfer_workspace_ownership`, ahead of the earning gate; the workspace `refusalFrom` maps it to a
  `403` with `details.reason = 'persona'` (`packages/backend/core/team-persona-gate.ts`). The Dev
  Context Switcher's **Operator mode** axis (`data-dev-operator`) drives the chrome live and the guard
  plus the team create route's mirror through the `pj.dev.operator-mode` cookie, honoured only when
  `DENO_ENV` is `development`.
- **Restricted accounts see only what they can use (Decision #192).** Ages are counted on today's date
  in the person's own IANA zone — `computeAge(dob, timeZone)` in `@projective/types/auth` and
  `org.fn_age_years(dob, zone)` in Postgres apply one rule; the join form sends the browser's zone,
  provisioning stores it as `users_public.timezone`, UTC when unknown. The chrome hides every surface
  `isRestrictedPath` names (`apps/web/features/shell/core/restricted-surfaces.ts` — Wallet, Businesses,
  basket/checkout, Catalogue, Services/Products, Teams, Analytics, Become a Freelancer, Settings →
  Billing / Verification) from the rail, the create menu and the account popover, and the
  `(dashboard)` middleware's third gate 303s a direct visit home. In-page buy/sell controls are
  replaced by one `InlineNotice` (`/view` lane and body block, profile rig, project create modal,
  Settings → Account); islands read the flag through `useEffectiveContext` / `useRestricted`, routes
  through `isRestrictedRequest`. A minor's projects are **personal** (`projects.is_personal`, table
  triggers in `00001130`): one person, no money, never listed, no members; the reads stamp
  `personal` on `ProjectDetail`, `ProjectSetup`, `ProjectWorkspace` and `BoardCard`, and the
  workspace drops Members, Preview, pricing, terms, Publish and every funding line.
- **Age policy v2 (Decision #208).** PRODUCT_SPEC §Age guardrails' tiers, enforced in Postgres first.
  **Under 13** leaves nothing: email sign-ups are refused before any write; an OAuth identity is
  deleted by `public.discard_underage_signup` (the caller's own, profile-less identity, under-13 date
  only) and `/api/auth/join` clears its session cookies; nothing about the attempt is logged; the
  browser session is locked (`SessionKeys.JOIN_AGE_LOCK` client-side, the data-less HttpOnly
  `pj_join_age_lock` cookie server-side). **13–17**: `trg_workspace_member_adult` refuses a minor on
  `team_members` / `business_members` / `enterprise_members` / `org_invitations`, and
  `create_workspace`, `respond_to_workspace_invitation` and `finance.record_payout_account` assert an
  adult; `scheduling.trg_schedule_age_gate` refuses published hours and accepted calls, and
  `request_discovery_call` / `reserve_seat` assert an adult; `comms.trg_dm_shield` (on
  `dm_participants` and `dm_messages`) admits a minor only between mutual follows; `search.record_view`
  records nothing, `trg_interest_events_minor` drops interest events and `fn_log_query` logs a minor's
  search anonymously; `get_profile_view` and `org.profiles_index` mask a minor's city, country and time
  zone from everyone but the owner; `trg_users_public_minor_visibility` keeps a minor's profile out of
  `public`. The app hides the matching surfaces (Scheduling settings, the availability editor and
  hours links, the "Public" visibility option) and maps each `PM403` to one sentence
  (`RESTRICTED_REFUSAL`, `DM_SHIELD_REFUSAL`). Any account may create a **personal** project
  (`CreateProject.personal` → `create_project`'s `is_personal`), labelled "Personal" instead of
  Draft. Teams and Businesses stay closed to minors; the 18+ proxy model is specified and disabled.

---

## Internationalization, Currency & Localization

Projective is a currency-global, locale-aware, bidirectional application. The contract is resolved
from **one source of preference** (`org.user_preferences`) and applied at read time.

### Layout direction (RtL / LtR)

- The app supports **both** left-to-right and right-to-left layouts. Direction is chosen by user
  preference (`org.user_preferences.layout_direction` — `ltr` / `rtl` / `auto`) **independent of
  language**; `auto` falls back to the natural direction of the user's `locale`.
- **Where it is set and painted (Decision #151):** Settings → Language & region saves it
  (`PATCH /api/user/preferences`), applies it on the device at once, and records it in the `pj.a11y`
  cookie, from which `_app.tsx` server-renders `<html dir>` on the next request. **`auto` is resolved
  by the viewer's locale (Decision #156):** `localeDirection` (`@projective/types/org`) reads the
  script — an explicit script subtag wins (`-Arab`, `-Hebr`, `-Thaa` …), otherwise the language
  (`ar`, `he`, `fa`, `ur`, `ps`, `sd`, `ug`, `yi`, `dv`, `ckb` …) — so `a11yRootAttributes` writes
  `dir="rtl"` for a right-to-left locale and nothing for a left-to-right one, and the Language section
  re-applies it the moment the locale changes. See §The Settings engine.
- **Mechanism:** the resolved direction is written as the `dir` attribute on the document root; the
  UI mirrors automatically because the codebase already styles with **CSS logical properties**
  (`inline-size`, `inset-inline`, `margin-inline`, `padding-inline`, `border-inline-*`) rather than
  physical `left`/`right`. Under RtL, sidebars flip to the right, list affordances mirror, and
  scroll/anchor logic follows the writing mode — with **no app-side per-component overrides**.
- **Migration target:** any remaining hardcoded physical-direction rule (`left:`/`right:`/
  `margin-left`/`text-align: left`) is a bug to convert to its logical equivalent. The RtL/LtR
  **token contract** is `DESIGN_SYSTEM.md` §A.6; UI implementation is a later pass (this is the
  contract).

### Locale & currency resolution

- `org.user_preferences.locale` (BCP-47, default `en-GB`) drives language, number/date formatting,
  and the `auto` direction fallback.
- **Money is stored in origin currency, displayed in the viewer's.** Stored/settled amounts are
  never converted. A **presentational currency-conversion service** resolves display figures at read
  time: it reads the viewer's `preferred_display_currency`, applies the **latest**
  `finance.fx_rates` row, and formats to locale — a pure read-model transform that touches no ledger
  row. The rate used at **commit** (settlement) is a separate, snapshotted value (`fx_*` columns)
  and is authoritative for money movement. See `finance-model.md` §11.

#### The implemented pipeline

One engine, one component, one direction. `rate` always converts BASE into QUOTE
(`amount_quote = amount_base × rate`), stated once in `@projective/types/finance/fx.ts` and never
re-derived — a caller that divides by a forward rate and one that multiplies by its inverse disagree
in the last minor unit, and a figure that changes with which direction the caller asked in is worse
than one that is merely stale.

| Layer            | Owner                                                        | Responsibility                                                                                                                                                              |
| :--------------- | :----------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rates            | `finance.fx_rates` (+ a seeded floor, both directions)       | Append-only observations. `FxService` is the only reader.                                                                                                                   |
| Engine           | `@server/services/finance/FxService.ts`                      | Per-base rate table cached 15 min in **Deno KV**, falling through to a per-isolate memory cache then to the seeded fixtures. `convertAmount()` returns the value **and** its `asOf` snapshot instant. Never throws; an unresolvable pair returns the ORIGIN unchanged. |
| Preference       | `org.user_preferences.preferred_display_currency` / `locale` | Stamped into the JWT by `custom_access_token_hook`; a guest's choice rides the `pj.currency` cookie so SSR can read it. `PATCH /api/user/preferences` writes it under RLS.  |
| Request scope    | `apps/web/utils/currency-context.ts`                         | Resolves the request's `(currency, locale, table)` and carries it through the whole render via `AsyncLocalStorage`.                                                        |
| Presentation     | `@projective/ui/display` `MoneyView`                         | Renders it. Formats with `Intl.NumberFormat` on the viewer's locale; discloses the origin inline when the currencies differ.                                               |

**Why `AsyncLocalStorage` and not a context provider or a module signal.** Both alternatives were
tried and measured. A Preact context provider at the document root is **not** visible to a server
component deeper in the page — an island boundary sits between them and island subtrees render in a
pass that does not carry the outer context (an app-side probe beside a price returned `null` while
the same probe directly under the provider returned the real value). A module-level signal is
visible everywhere but is shared across concurrently-rendered requests, so one viewer's currency
could change what another is midway through rendering. `AsyncLocalStorage` is request-scoped and
survives every `await` and every render pass, so it has neither failure. The context provider is
still mounted as the first, portable link in the chain; the ambient resolver is the backstop.

**Switching currency does not reload the page.** A change writes the shared signal store (which
re-renders every figure inside a hydrated island), sweeps every server-rendered `[data-money]` node
in the document from its own immutable origin attributes, persists to `localStorage` + the cookie,
then PATCHes the durable preference and reconciles against what the server actually stored. The
sweep converts from the ORIGIN every time, never from the previous conversion, so flipping
GBP → EUR → GBP returns the exact starting figure rather than one rounding away from it.

### Financial idempotency

Every money-mutating operation is idempotent: the service presents an operation key recorded in
`finance.idempotency_keys` (paired with Stripe's `Idempotency-Key`), so a retried request or
redelivered webhook replays the stored result instead of re-executing. This is a hard requirement
for any code path that moves money.

Three key namespaces share the table (Decision #125): a caller's attempt key for a wallet movement
(`transfer:<uid>`, `distribute:<uid>` scopes) or a card payment (`card_payment:<uid>` — the same key
also names the Stripe PaymentIntent, `projective:payment_intent:<payment id>`), and
`stripe:<evt_id>` (scope `stripe.webhook`) for every processed Stripe event, claimed in the same
transaction as the event's effects so a delivery that failed half-way is simply processed again.

---

## Caching Strategy

Projective uses a tiered caching strategy to minimize latency and database load. We prioritize
"Stale-While-Revalidate" (SWR) patterns to ensure the UI is always responsive while data remains
fresh.

### Server-Side: Deno KV

Deno KV is our high-performance, atomic key-value store. We use it to offload Supabase read pressure
and manage ephemeral server state.

#### Maximizing Deno KV Potential

- **Secondary Indexing:** Since KV is key-ordered, we store data under multiple keys (e.g.,
  `['users', id]` and `['users_by_email', email]`) within an `atomic()` transaction to allow $O(1)$
  lookups by different attributes.
- **TTL (Time-To-Live):** We utilize the `expireIn` option for API response caching.
  - _Example:_ Cache project metadata for 5 minutes (`300_000ms`) to reduce RPC calls.
- **Atomic Operations:** Use `kv.atomic()` for counters (e.g., profile views) or optimistic locking
  to prevent race conditions during concurrent writes.
- **Queues:** Leverage `kv.enqueue()` for background tasks like processing images via WASM or
  sending notifications without blocking the HTTP response.

### Browser Storage: Local vs. Session

We strictly separate persistent configuration from transient session state to ensure a clean user
experience across tabs.

| Storage Type        | Usage Context                          | Examples                                                            |
| :------------------ | :------------------------------------- | :------------------------------------------------------------------ |
| **Local Storage**   | Permanent preferences & Heavy Metadata | Theme (Light/Dark), Language, Offline Drafts, E2E Public Keys.      |
| **Session Storage** | Tab-specific UI state                  | Multi-step form progress, scroll positions, "Back-to-List" filters. |
| **IndexedDB**       | Large Data Blobs                       | Cached WASM binaries, large project datasets for `DataDisplay`.     |

- **Logic Rule:** Never store sensitive JWTs in Local Storage if XSS risk is high; prefer HTTP-only
  cookies managed via Fresh middleware.

### Service Workers (SW)

Service Workers act as a programmable proxy between the Fresh App and the Network.

#### Best Practices

- **Pre-caching Assets:** On `install`, the SW fetches and caches the core UI bundle, CSS variables,
  and essential WASM modules.
- **Navigation Preload:** Enabled to allow the browser to start downloading the page HTML while the
  Service Worker is booting up.
- **Caching Strategies:**
  - **Cache-First:** For immutable assets (Fonts, Icons, compiled WASM).
  - **Network-First:** For critical data like User Profile or Permissions.
  - **Stale-While-Revalidate:** For the `GanttChart` or `Kanban` data, allowing the user to see the
    last-known state instantly while the new data fetches in the background.

#### Offline handling — what is shipped (2026-09-20)

The SW above is the **floor**: `apps/web/static/sw.js` holds a runtime shell cache (network-first
documents, cache-first hashed assets, never `/api/*`, never a non-`GET`) and answers a navigation it
cannot satisfy with an **inline fallback page**. That page is kept for the cases no in-page code can
see — a cold load while offline, a programmatic `location.assign`, a native form submission, a
connection that drops after a navigation has started. Everything below sits ABOVE it and is
installed once per document by the `OfflineBridge` island (`features/shell/islands/`, mounted from
`routes/_app.tsx`); the rules it applies are pure and unit-tested in `apps/web/utils/offline.ts`.

`isCacheable` in `sw.js` also refuses any request carrying a `Range` header. Together with the
`/api/*` rule this keeps every private byte out of the worker's cache: the file inspector reads only
through `/api/media/proxy/[fileId]` (Decision #161), so neither a whole file nor a media seek is ever
stored, and that route must stay under `/api/`. The `/vendor/<lib>/<version>/…` decoder trees follow
the ordinary static-asset rule (`isStaticAsset`: a `.js` or `.ttf` is cached, a `.wasm` or `.bcmap`
passes to the network); their paths are versioned, so a hit is never stale. `handleNavigation`
never stores a document whose `cache-control` says `no-store` (Decision #161(j)), so a
`private, no-store` page — `/inspect/[fileId]`, `/share/[slug]`, `/exit`, `/invite/[token]` — is
never replayed offline from the shell cache; offline, such a page gets the inline fallback.

| Layer | Mechanism | Rule |
| :-- | :-- | :-- |
| **Connectivity** | `utils/network.ts` `isOnline` — one shared signal, `navigator.onLine` trusted in the `false` direction only. | A `true` is "worth trying"; nothing but the browser's `offline` event may declare the app offline. |
| **Navigation** | A delegated, BUBBLE-phase `document` click listener (`utils/offline-guards.ts`), not a `Link` component. | Only an unmodified, primary-button, same-tab, same-origin, non-`/api/`, non-`download`, non-fragment click is intercepted. Default is prevented synchronously, then the shell cache is asked (`CacheKeys.SHELL_CACHE`, the same two lookups `sw.js` makes): stored → the guard navigates; not stored → the **interstitial** opens (`Dialog`, `role="alertdialog"`, heavy scrim tier, the SW fallback's own copy). A handler that already `preventDefault`ed is honoured; one that stops propagation falls through to the SW floor. |
| **Writes** | A reference-counted wrapper on `globalThis.fetch`, and the same check inside `apiFetch`. | A same-origin `POST`/`PUT`/`PATCH`/`DELETE` while offline is answered locally with the app's own `{ ok: false, message, code: "offline" }` envelope as a `503` (a transport folds a rejection into a generic sentence; it forwards an envelope's `message` verbatim). Reads pass through. `keepalive` sends, `x-pj-background: 1`, and `/api/logs` · `/api/telemetry` · `/api/analytics` are background and never refused. One `warning` toast per 4s burst. **Nothing is replayed**: the only queue is the project editor's own (`features/projects/core/offline-queue.ts`), which checks `isOnline` before it sends, because replaying a POST the guard did not understand is how a purchase happens twice. |
| **Paginated reads** | `utils/use-offline-stall.ts` in every infinite-scroll island (explore feed, chat feed, file + submission explorers, files hub, wallet ledger, catalogue console). | A next page that fails while the browser is offline appends an `InlineNotice` ("You are currently offline." + an underlined **Retry**) at the list's LOADING edge — the top of a chat feed — and stalls the sentinel so it cannot loop; the reader's Retry or the offline→online edge loads again. Never the interstitial. |
| **Status** | `Ribbon` (`@projective/ui/feedback`), bottom-pinned. | Empty at rest: the strip carries words only once an offline state has been established — "You are offline…" while the connection is gone, "Back online." for 2.5 s after it returns (a transition OUT of offline, never a greeting; the bridge derives the words from the last notice, not from "online right now", and the component renders no content while hidden); reserves `--ribbon-inset` so the footer band, bottom toasts and the page tail move up with it. `_app.tsx` pre-paints `:root[data-ribbon]` from `navigator.onLine` so a shell-cached page opened offline does not shift on hydration. |

### What to Cache (Selection Guide)

1. **Expensive Computations:** Results from WASM-based file compression or video handling should be
   cached in `IndexedDB` to avoid re-processing.
2. **Static Metadata:** Roles, Enums, and "Projective" platform configurations.
3. **Search Results:** Recently accessed `pgvector` search results can be cached in Deno KV to
   provide instant suggestions for common queries.

### Implementation Patterns

**Server-Side (Deno):**

```ts
// #region KV Cache Helper
/**
 * Wraps a service call with Deno KV caching logic.
 */
export async function withCache<T>(
	key: Deno.KvKey,
	fetcher: () => Promise<T>,
	ttl = 60_000,
): Promise<T> {
	const kv = await Deno.openKv();
	const cached = await kv.get<T>(key);

	if (cached.value) return cached.value;

	const fresh = await fetcher();
	await kv.set(key, fresh, { expireIn: ttl });
	return fresh;
}
```

---

## The Core Data Model (ERD & Zod Schemas)

To prevent type-drift and AI hallucinations, `@projective/types` acts as the **Single Source of
Truth (SSOT)** for the data model.

- **The Rule:** No table or column may exist in the Supabase SQL migrations without a perfectly
  matched Zod schema and TypeScript interface in the `types` package.

---

## State Hydration (Server to Island)

Fresh utilizes the "Islands Architecture." The boundary between server-rendered HTML and client-side
interactivity must be strictly maintained.

- **Data Fetching:** Data is **never** fetched directly inside an Island component via Supabase
  client.
- **The Pipeline:** 1. The Fresh Route (`/routes/projects/[id].tsx`) executes a Server-Side call to
  a backend Service (e.g., `ProjectService.getById()`). 2. The Route passes the resolved data down
  to the Island as standard props (e.g., `<ProjectBoardIsland initialData={project} />`). 3. The
  Island receives `initialData` and instantly hydrates it into a local `@preact/signals` state or
  Store class for high-performance interactivity.

---

## Integration Blueprints

"Integrations" must be structurally defined to prevent autonomous agents from hallucinating
incorrect API flows.

### 1. Stripe (Financial Engine)

- **Architecture:** We utilize **Stripe Connect Express** for Freelancers and Teams — in current
  Stripe terms an **Accounts v2** account with `dashboard: "express"`, the **recipient**
  configuration (`stripe_balance.stripe_transfers`) and `fees_collector`/`losses_collector:
  "application"` (never the deprecated v1 `type: "express"`). This offloads KYC/AML compliance to
  Stripe. The platform owns the **ledger of record** (`finance.wallets` / `finance.transactions` /
  `finance.escrows` — who is owed what); Stripe owns the **fiat rails**.
- **Payment Flow:** We use **Separate Charges & Transfers** (§8 Decision #125). The Client's card is
  charged on the **platform** account (tap-and-pay, no client KYC) with no `transfer_data`; the
  settled amount is credited to a Projective wallet and held in the platform's Stripe balance (acting
  as Escrow); on approval the ledger releases it, and payouts move it to the connected Express account
  as **Transfers** (grouped by `transfer_group`), the 5% fee retained by transferring less. This
  line previously said **Destination Charges** while describing hold-in-platform-balance behaviour.
  A destination charge transfers to the connected account the moment the payment succeeds, so it
  cannot hold escrow until approval, needs the payee at charge time (a stage's payee is known only at
  claim), and has one destination (a team payout splits across members). **Confirmed by the product
  owner 2026-09-29** (Decision #125): Separate Charges & Transfers is the pattern.
- **Identity & readiness (KYC/KYB):** **Stripe Identity** performs the freelancer Level-2 gov-ID /
  liveness check; **Stripe Connect** onboarding performs business KYB. The verdicts are mirrored
  into the app-owned caches (`org.freelancer_profiles.kyc_*`, `org.business_profiles.kyb_*`) and the
  `finance.verification_cases` trail — **only opaque provider references are stored, never PII**.
  The freelancer payout-ready gate (`finance.fn_freelancer_payout_ready`, enforced at every door that
  lands a gig or seats a team member by `finance.fn_assert_payout_ready` — `PK403 payout_not_ready`,
  Decision #196) is the "no forever-escrow"
  guarantee.
- **Idempotency:** every money-mutating call carries a `finance.idempotency_keys` key (and Stripe's
  own `Idempotency-Key` header) so a retried webhook or request **never double-moves money**.
- **FX:** cross-currency commits snapshot the rate used (`finance.fx_rates` → `fx_rate`/`fx_base`/
  `fx_as_of` on the ledger row) so settlement is reproducible; display conversion is read-time only.
- **Webhooks:** The `PaymentService` listens on TWO event destinations. The snapshot endpoint
  (`/api/finance/webhooks/stripe`, `STRIPE_WEBHOOK_SECRET`) takes `payment_intent.*`,
  `identity.verification_session.*`, `transfer.created`, `transfer.reversed`,
  `charge.dispute.created`/`.closed`, `account.updated` and `setup_intent.succeeded`, and — signed by
  the platform's CONNECT destination (`STRIPE_CONNECT_WEBHOOK_SECRET`, which may share the URL; the
  endpoint verifies against either secret) — a connected account's `payout.paid` / `payout.failed`
  (Decision #202; a payout event without `event.account` is the platform's own and is ignored); the Accounts v2 **thin**-event endpoint
  (`/api/finance/webhooks/stripe-v2`, `STRIPE_THIN_WEBHOOK_SECRET`) takes the recipient-capability and
  account-updated events, which carry only an id, so the handler re-reads the account from Stripe before
  applying anything. Both update the `transactions` ledger, the verification caches and
  `finance.chargebacks`. Reconciliation compares the Stripe balance against the internal escrow pool
  (and `finance.v_wallet_reconciliation` checks ledger self-consistency).
- **Ledger integrity (Decision #186):** `finance.transactions` is the record and is **append-only
  for every role**: a trigger refuses `UPDATE`, `DELETE` and `TRUNCATE` (`PL403`) even for the
  table owner and the service role (which holds only `SELECT` + `INSERT`), `wallet_id` is
  `ON DELETE RESTRICT`, and a correction is a compensating row. `finance.wallets.balance_cents` is a
  cache written beside the ledger by `fn_wallet_credit` / `fn_wallet_debit` only, and both
  **raise `PW404`** when the wallet is missing rather than returning, so a credit can never vanish:
  a webhook settlement that hits it rolls back with its event claim, answers 5xx and is redelivered by
  Stripe. Callers that may pay an owner for the first time run `fn_ensure_wallet` first.
  `finance.fn_reconcile_wallets()` (service role, pg_cron `finance-reconcile-wallets` nightly at
  03:40 UTC) compares each cache with the ledger sum and the newest `balance_after_cents`, writes one
  `ops.log_entries` `error` row per drifted wallet (`scope = 'finance.reconcile_wallets'`) and never
  corrects anything. Proven by `supabase/probes/ledger_immutability.sql`.
- **The pending window (Decision #191):** earned credits (escrow releases and their team splits,
  fair-exit and seat payouts, product sales) go through `finance.fn_wallet_credit_pending`, which
  writes a `finance.pending_releases` row and no ledger line; `finance.fn_mature_pending_releases()`
  (service role, pg_cron `finance-mature-pending-releases` hourly at :05, `SKIP LOCKED` batches)
  credits each matured row through `fn_wallet_credit`. `balance_cents` is Available only, so every
  spend door and `begin_payout` use Available money, and the reconciliation above still holds. A lost
  chargeback recovers from the payer wallet's pending rows first (`fn_recover_from_pending`). The
  wallet overview reads Pending as `amount_cents − recovered_cents` (`services/finance/pending-window.ts`).
  Proven by `supabase/probes/pending_window.sql`.

#### 1.1 What is implemented (Phase 1, 2026-09-29 — Decision #125)

| Capability | Thin route | Fat method (`PaymentBackendService`) | Database doors (`00001230`) |
| :--------- | :--------- | :----------------------------------- | :-------------------------- |
| Fund a stage's escrow by card — every unfunded ticket in an open, assigned or in-progress stage, claimed or not, held PREPAID until claimed; refused up front while any ticket is unpriced (Decision #197; UI: the stage board's `FundStageDialog` and the wallet's Fund a stage) — or ONE ticket with `ticketId` (Decision #166: that ticket's price, only its escrow held at settlement via `projects.fund_ticket`) | `POST /api/finance/escrow/intent` | `createEscrowLockIntent` | `begin_card_payment` (`p_ticket_id`) · `attach_card_payment` · `abandon_card_payment` |
| Pay for ONE paid revision round by card (Decision #199: the round's snapshotted price; settlement runs `projects.fund_paid_revision` as the payer, which holds the round's escrow and opens it) — or from the wallet, straight through `fund_paid_revision` | `POST /api/projects/:id/stages/:stageId/submissions/:submissionId/paid-revision/fund` | `createPaidRevisionIntent` (via `RevisionPurchaseBackendService.fundPaidRevision`, `revision-purchase.ts`) | `begin_card_payment` (`p_revision_id`) · `attach_card_payment` · `abandon_card_payment` |
| What funding a stage takes for the payer (Decision #197): unfunded tickets, unpriced ones, the paying wallet and its balance | `GET /api/finance/escrow/quote?project=&stage=` | `StageFundingBackendService.quote` (`stage-funding.ts`) | `projects.get_stage_funding_quote` → `projects.fn_stage_funding_need` |
| Top a wallet up by card | the wallet's `top_up` action (`POST /api/wallet/action`) — the only door; the standalone `/api/finance/topup/intent` was retired with no caller | `WalletBackendService.topUp` → `createTopUpIntent` | the same three |
| Payout account (Connect) onboarding | `POST /api/finance/connect/onboarding` · `GET …/refresh` (Stripe's `refresh_url`) · `GET …/return` (`return_url`) · `GET …/status` | `startConnectOnboarding` · `refreshConnectOnboarding` · `connectStatus` | `payout_account_for` · `record_payout_account` · `sync_payout_account` (service role) |
| Identity (Level-2 KYC) | `POST /api/finance/identity/session` | `createIdentitySession` | `begin_identity_verification` · `attach_identity_session` · `abandon_identity_verification` |
| The webhook | `POST /api/finance/webhooks/stripe` | `handleStripeWebhook` | `settle_card_payment` · `record_card_payment_failure` · `apply_identity_event` · `record_transfer_created` · `record_transfer_reversed` · `record_bank_payout` · `record_dispute_opened` (service role) |

- **Order of every user-initiated call:** gate (signed in → 401; `FINANCE_BACKEND_LIVE` + a
  well-formed key → else 503) → **record the request** through a user door (authorised by
  `auth.uid()`; the escrow amount is computed by the database) → call Stripe with an
  `Idempotency-Key` derived from that row → **bind** the Stripe object to the row, write-once.
- **Identity and payout verdicts are processor-only.** `apply_identity_event` (claimed as
  `stripe:<evt_id>`) and `sync_payout_account` are the only writers of a case's decision, a payout
  account's status and the profile's `kyc_status` / `kyc_verified_at` / `payout_ready` cache; a
  verified case never regresses. Proven by `supabase/probes/identity_payout_doors.sql`.
- **Only the webhook settles.** A card payment becomes money only on the signature-verified
  `payment_intent.succeeded`, which credits the wallet (`topup`) and — for an escrow lock — runs
  `projects.fund_stage` **as the payer who authorised it** (`request.jwt.claim.sub` set to the row's
  `created_by` inside the definer), in a subtransaction: a lock refused at settlement never rolls back
  the credit.
- **A settlement is acknowledged only with its ledger row (Decision #200).** `settle_card_payment`
  returns `transaction_id` on every outcome it completes; a lock or order refused after the credit
  leaves the payment `settled_unapplied` (with `unapplied_reason`) and the payer is told the funds are
  in their wallet. A success it cannot credit YET (no payment bound to the intent) releases its
  event claim, so the webhook answers 5xx (`requireLedgerRow` in `stripe-webhook.ts`) and Stripe's
  retry is processed, not replayed — as does any settlement that failed for a transient reason (the
  call raised and rolled its claim back). A success whose amount / currency can NEVER match its
  payment is deterministic, so it is not retried: the claim is completed with
  `reconciliation = 'settlement_mismatch'`, the webhook answers 2xx, ONE `ops.log_entries` error row
  and a WARNING are written, nothing is credited, and redeliveries replay that outcome. A
  `payment_intent.succeeded` without `metadata.projective_payment_id` was not created by Projective
  and is acknowledged as ignored. `finance.v_ops_unledgered_payments` (service role) lists any settled
  payment without its ledger credit, and every `settlement_mismatch` still awaiting a human.
- **Every processor door is idempotent on the Stripe event id** (`stripe:<evt>` in
  `finance.idempotency_keys`, claimed in the same transaction as the effects). Handled events:
  the four above plus `payment_intent.payment_failed`/`.canceled` and
  `identity.verification_session.requires_input`/`.canceled`. A test-mode event on a live deployment
  (or the reverse) is acknowledged and ignored.
- **Code:** `packages/backend/core/stripe.ts` (lazy client, key-shape validation, webhook
  verification with Web Crypto) · `services/finance/{PaymentBackendService,live-payments,stripe-rails,stripe-webhook}.ts`
  · Zod SSOT `@projective/types/finance` (`payments.ts`). SDK `npm:stripe@22`, API version pinned
  `2026-08-26.dahlia`.
- **Phase 2** — withdrawals, saved cards, recurring deposits, the Income Smoother, dispute outcomes,
  thin events, business KYB and the browser surfaces — landed in Decision #126: see §1.2.

#### 1.2 What is implemented (Phase 2, 2026-09-30 — Decision #126)

The same two-door order as §1.1; the new database doors are `00001240_functions_finance_money_movement.sql`
(documented in `documentation/database/finance/Functions.md` → "Money movement after the fiat rails").

| Capability | Thin route | Fat method | Database doors |
| :--------- | :--------- | :--------- | :------------- |
| Withdraw to the payout account | `POST /api/wallet/payouts` (and the wallet's `withdraw` action) | `WalletBackendService.withdraw` → `PaymentBackendService.withdraw` | `begin_payout` (user) · `complete_payout` · `fail_payout` (service role) |
| Save a card (SetupIntent) | `GET /api/finance/cards/setup` (the publishable key for deferred Elements, Decision #152) · `POST /api/finance/cards/setup` · `POST /api/finance/cards/confirm` (and the wallet's `add_method` action) | `cardSetupConfig` · `createCardSetup` · `confirmCardSetup` | `card_owner_for` · `record_processor_customer` (user) · `record_saved_card` (service role) |
| Pay at checkout by card or express wallet | `POST /api/checkout/create` (`provider: "card"` · `"express"`) → `GET /api/finance/payments/[id]` | `CheckoutBackendService.create` → `createCheckoutCardPayment` | `ensure_purchase_wallet` + the §1.1 card doors + `attach_checkout_order` (user, Decision #153), then `place_wallet_order` — by the browser AND by `settle_card_payment`, under one key. A one-ticket line (Decision #166) settles inside it by `projects.fund_ticket` (an escrow hold from the topped-up wallet), not a sale |
| Recurring deposits | the wallet's `new_recurring` action · `POST /api/finance/cron/deposits` (bearer `FINANCE_CRON_SECRET`, 404 otherwise) | `processDueDeposits` → `chargeScheduledDeposit` (`scheduled-deposits.ts`). A transient Stripe / network failure leaves the run unbound; the next sweep re-offers the SAME run (`retry`) under the same idempotency key `scheduled_deposit:<payment id>` for up to 23 h (then it is failed with an ops row, never re-sent past the key's life), so a period is neither lost nor charged twice. Only a declined card / required authentication counts against the rule | `create_deposit_rule` (user) · `claim_due_deposit_rules` · `bind_scheduled_payment` (service role) |
| Stale payouts | `POST /api/finance/cron/payouts` (bearer `FINANCE_CRON_SECRET`, 404 otherwise; R2 job `finance-sweep-stale-payouts`) | `sweepStalePayouts` | `fn_claim_stale_payouts` · `complete_payout` · `fail_payout` (service role) |
| Income Smoother enrolment | the wallet's `enrol_smoother` action | `WalletBackendService.enrolSmoother` | `set_income_smoother` (user) |
| Verification console (`/settings/verification`) | `GET /api/finance/verify/status` · `POST /api/finance/verify/kyc` · `POST /api/finance/verify/kyb` | `verificationStatus` · `createIdentitySession` · `startKybOnboarding` | `my_verification_status` · the §1.1 identity + Connect doors |
| Force the earning gate open (development only — Dev Tools Context Switcher → Money → Earning gate) | `POST /api/finance/verify/force` (404 unless `DENO_ENV=development`) | `DevVerificationBackendService.forcePayoutReady` | `begin_identity_verification` · `attach_identity_session` (user, synthetic `vs_dev_…`) → `apply_identity_event` (service role, synthetic `evt_dev_…`) · `record_payout_account` (user, synthetic `acct_DEV…` when none exists) → `sync_payout_account` `verified` (service role). A synthetic account is not a Stripe account: withdrawals and Stripe status syncs refuse it |
| Dispute outcome | the snapshot webhook (`charge.dispute.closed`) | `handleStripeWebhook` | `record_dispute_closed` (service role) |
| Connect status sync | both webhooks (`account.updated`; thin v2 events) | `handleStripeWebhook` · `handleStripeThinWebhook` | `sync_payout_account` (service role) |
| Invoice / statement PDF | `GET /api/finance/invoices/[id]/pdf` · `GET /api/finance/statements/[id]/pdf` | `WalletBackendService.documentPdf` | RLS-scoped reads (`View invoices you are party to`) |
| Poll a pending escrow-lock card payment as a funding state (Decision #170) | `GET /api/finance/payments/[id]/status` → `{paymentId, status, lockStatus, funding}` (a top-up is a 404) | `PaymentBackendService.paymentFunding` → `paymentFundingState` (the one `deriveFundingState`) | RLS-scoped read of `finance.inbound_payments` |

- **A card or express checkout is a top-up, then a wallet order** (Decision #153 revises Decision
  #126 here). The processor charge tops up the PAYING account's wallet (created in the charge currency if
  missing), and the order is placed from the wallet under the checkout's OWN attempt key — by the browser
  once the signed webhook has credited the wallet, AND by `settle_card_payment` itself, as the payer, from
  the `checkout` the browser attached (`finance.attach_checkout_order`) before any intent existed.
  Whichever comes second replays, so the order exists even when the browser never returns, and a
  refused order leaves the money in the wallet with `order_error`. One charge path, one ledger. A saved
  card is charged in place — confirmed server-side, with a bank's 3-D Secure challenge answered in the
  browser by Stripe.js `handleNextAction` (`CardPaymentHandoff.confirmation`); a new card is entered
  through the Add-card form (a SetupIntent), never typed into the checkout.
- **Charged in the listing's own currency, shown in the buyer's.** The processor is charged the
  session's `charge` — the order total in the listings' currency, computed by re-reading the same basket
  in that currency through the same `toTotals` (`chargeFor`), so the figure shown and the figure charged
  are one computation; the display currency no longer gates the card (#126(g) resolved). The checkout
  rail states both (`AED 840.27 (~US$229.00 USD charged)`, with the locked rate).
- **Express wallets are Stripe's Express Checkout Element** (`provider: "express"`): mounted in
  deferred-intent mode for the `charge`, it shows whichever of Apple Pay, Google Pay and PayPal the
  device, browser and account allow (HTTPS required; Apple Pay also needs the payment-method domain
  registered). On confirm the server opens the PaymentIntent (automatic payment methods, matching the
  deferred Elements group); a redirect-based wallet returns to `/checkout/payment?pay=<payment>&attempt=<key>`
  and the page resumes that payment. The CSP is unchanged — the Element runs in Stripe's own frames.
- **Withdrawals debit first.** `begin_payout` debits the wallet (`payout`) before the Transfer is
  created, so money in flight cannot be spent twice; a definitive Stripe refusal credits it back
  (`payout_reversal`); a transient failure leaves the payout `pending` for `transfer.created` to settle.
  `paid` means the Transfer exists; Stripe pays the bank on its own schedule.
- **After the transfer (Decision #202).** A payout below `min_withdrawal_minor` is refused; a named
  destination must be the owner's active payout method. Every transfer carries the group
  `projective_payout_<id>` and its payout id in metadata. The stale sweep finds a stuck payout's
  transfer by that group (then by scanning the destination's transfers for the metadata) and completes
  it; with none it re-sends under the same idempotency key while Stripe still holds it (23 h), and
  returns the money after. `transfer.reversed` credits back only the newly reversed amount. A connected
  account's bank payout is resolved to the transfers it carried through its balance transactions
  (`payout` filter, `Stripe-Account` header — automatic payouts only) and recorded as `bank_status`;
  a restricted key needs Balance transactions (read).
- **Individual clients escrow too.** `finance.escrows.payer_user_id` (one payer column set, never two)
  lets a project with no client business be funded — by card or from the owner's wallet — and every
  release, refund and fair-exit split returns money to the wallet type the payer holds. Releases charge
  `platform_fee_bp` (**500 = 5 %**, Decision #2), or the payer's negotiated rate.
- **A lost dispute** refunds the still-frozen escrows to the payer's wallet, then debits the disputed
  amount from it (`chargeback`) as far as the balance covers; the rest is `unrecovered_cents` — the
  platform's loss. A won dispute returns the escrows to `held`.
- **Not built:** Income Smoother disbursement (enrolment and its fee are recorded; nothing buffers or
  pays out yet, so no fee is charged), the Instant Payout fee (undecided, #55(c)), clawing a LOST
  dispute back from escrow already released to a freelancer, passing Stripe's dispute fee on, the
  scheduled payout-schedule run, stored PDFs (they are rendered per request), and a nonce-based CSP.

#### 1.3 Test-mode verification and the smoke test (2026-10-10)

**Automated: `deno task smoke:stripe`** (`scripts/stripe-smoke.ts` + `scripts/stripe-smoke.sql`). Needs
the seeded local stack (`deno task db:reset`) and stripe-mock
(`docker run -d -p 12111:12111 stripe/stripe-mock`). It creates the escrow PaymentIntent and the payout
Transfer through the real `stripe-rails.ts` builders against stripe-mock, checks the webhook contract
in-process (missing/forged signature → 400 on both endpoints, unknown event → 200 `ignored`, wrong mode
→ `ignored`), then runs the ledger half as the real roles (`authenticated` with the payer's claims for
user doors, `service_role` for processor doors) in one transaction that is **rolled back**:

| Path | What it checks |
| :--- | :------------- |
| Decline (`4000 0000 0000 9995`) | `payment_failed` leaves the lock `pending`; `canceled` sets `lock_status = failed` with a reason; no money moves |
| "Less arrived than the stage needs" | the amount received is credited to the wallet; nothing is held; `lock_error` is readable by the payer under RLS (what `GET /api/finance/payments/[id]` returns to the polling UI) |
| "The stage no longer exists" | `project_stage_id` set NULL (the FK's `ON DELETE SET NULL`) → lock `failed`, the full amount is in the wallet |
| Success (`4242…`; `3155` after its 3-D Secure challenge) | `inbound_payments.lock_status = locked`, its `locked_escrow_ids` are `held`, credit + hold net to zero |
| Idempotency | the same event replayed and a second event for the same PaymentIntent both answer `replayed`; no ledger row, no balance change |
| Top-up | credited once; the replay is ignored |
| Payout | release credits the freelancer; `begin_payout` is refused until **both** halves of `fn_freelancer_payout_ready` hold (a verified payout account alone is not enough); then the payout goes to the verified account, `complete_payout` binds the Transfer, `transfer.created` is `applied` then `replayed`; the wallet is debited once |
| After the transfer (#202) | a withdrawal below the minimum is refused; a partial `transfer.reversed` credits only its part, once; a connected account's `payout.failed` is recorded (the transfer stands) and the owner told, and a later re-paying `payout.paid` marks it paid; a stale pending payout is claimed with its destination; against stripe-mock, the grouped transfer, the sweep's lookup and the bank payout's balance-transaction read are well-formed, and a Connect-signed delivery verifies |
| Reconciliation | `finance.v_wallet_reconciliation` shows no drift |

stripe-mock serves no Accounts v2 (`/v2/core/accounts`), so the smoke records Connect onboarding through
its doors (`record_payout_account` → `sync_payout_account`), exactly as `account.updated` would.

**Manual: real test mode with the Stripe CLI.** The CLI signs every forwarded delivery with ONE secret
per `listen` session, so both webhook secrets take the same value locally.

1. `.env.local` (never committed): `STRIPE_SECRET_KEY=rk_test_…` (a restricted key is preferred) or
   `sk_test_…`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…`, `FINANCE_BACKEND_LIVE=true`,
   `DENO_ENV=development`, `APP_URL=http://localhost:<port>`, no `STRIPE_API_BASE`.
2. `stripe login`, then forward both endpoints. `listen` forwards Connect events to `--forward-to`
   too; in the Dashboard, by contrast, `account.updated` for a connected account reaches only a
   destination whose events come from **connected accounts**, so production needs that destination in
   addition to the account-events one.

   ```bash
   stripe listen --forward-to localhost:<port>/api/finance/webhooks/stripe --forward-thin-to localhost:<port>/api/finance/webhooks/stripe-v2 --thin-events "v2.core.account[configuration.recipient].capability_status_updated,v2.core.account.updated"
   ```

   Copy the printed `whsec_…` into both `STRIPE_WEBHOOK_SECRET` and `STRIPE_THIN_WEBHOOK_SECRET`, then
   start `deno task dev`.
3. Card escrow: open a stage's lock (`POST /api/finance/escrow/intent`), pay with `4242 4242
   4242 4242`, `4000 0025 0000 3155` (approve the challenge) and `4000 0000 0000 9995`; watch
   `GET /api/finance/payments/[id]`. Replay a delivery with `stripe events resend evt_…` — the answer
   is `replayed` and no ledger row is added.
4. Connect: `POST /api/finance/connect/onboarding` → finish the hosted test onboarding (test data,
   `000-000` SMS code, `000000000` SSN digits) → `account.updated` and the thin capability event sync
   `payout_ready`. Withdraw from the freelancer wallet (`POST /api/wallet/payouts`).
5. **Transfers need AVAILABLE platform balance.** A `4242` charge lands in the *pending* balance, so a
   test-mode Transfer right after it fails `balance_insufficient` (the payout is failed and the money
   returned to the wallet — correct, but not the path you meant to test). Fund the test balance first
   with a `4000 0000 0000 0077` charge (available immediately).

**Findings (2026-10-10).** Signature verification (raw body, 300 s tolerance, Web Crypto), event-id
idempotency (`stripe:<evt>` claimed in the same transaction as the effects), the 2xx-on-unknown rule, the
settle-only-on-webhook rule, the subtransaction that keeps a refused lock's money in the wallet and
the payout gate were verified by the smoke test; the checkout-via-top-up order placement (Decision
#153: both the browser and `settle_card_payment` place the order under one key) by code review only.
Fixed in this pass:
(a) nothing stopped a LIVE key outside production — the server now refuses to boot
(`assertStripeKeyAllowed`); (b) `record_transfer_created` matched the destination account by strict
`owner_type` while `fn_payout_destination` treats `user`/`freelancer` as one person, so a payout whose
Transfer call timed out (the 202 path, where `transfer.created` is the only closer) could be left
`pending` with the money debited — it now uses the same rule. Not exercised against real Stripe from
this machine (no test keys or CLI were installed): the hosted onboarding, the 3-D Secure challenge UI,
and the live `stripe listen` forwarding — run the manual steps above.

### 2. Conferencing (Session Engine)

- **Architecture:** Freelancers connect their preferred conferencing tools via **OAuth** (e.g.,
  Google Calendar/Meet API, Zoom API) from their profile settings.
- **Room Generation:** When a Session time is finalized, the `SessionService` uses the Freelancer's
  OAuth token to generate a unique meeting link.
- **Verification:** The system listens to server-to-server Webhooks (e.g., Zoom's
  `participant_joined`) to power the "Digital Handshake" attendance logs.

### 3. The Integration & Plugin Platform (`integrations` schema)

Conferencing above is one consumer of a general **connector + plugin substrate**: the `integrations`
schema, redesigned 2026-07-25 from a calendar-only connection store into a generic
provider / consent / sync framework plus a plugin ecosystem. Full schema in
[`documentation/database/integrations/`](../database/integrations/Tables.md) and shapes in
`@projective/types/integrations`. This is a durable architectural spine, so its rules are pinned
here.

#### 3.1 Four systems, not one — the boundary that must never blur

The word "integration" spans four subsystems with **irreconcilable runtime and trust models**.
Conflating them (one "integrations" module for all four) is the mistake that cannot be undone
cheaply, so the boundary is drawn on **capability shape**, not on which vendor is involved:

| System | What | Runtime | Home |
| :--- | :--- | :--- | :--- |
| **Auth** | SSO / OAuth login | Identity federation, no token retained | **GoTrue** (`apps/web/features/auth/`) — _not_ this schema |
| **Infra** | Payments, geocoding | Server-to-server, platform-owned keys | Behind the service layer — _not_ this schema |
| **Connectors** | A user's stored authorization to act at a third party | Per-user OAuth, token vault, sync, webhooks | `integrations` (§3.2) |
| **Plugins** | Third-party code injected into the app | Sandboxed, capability-scoped | `integrations` (§3.4) |

The same vendor spans tiers (Google is Auth **and** a Calendar connector **and**, later, a plugin) —
so the **`(provider, capability)` pair**, not the provider, is the unit of architecture.
**Authentication ≠ authorization**: a user signed in "with Google" still grants a Google Calendar
**connection** separately, and that connection's token lives in the vault — never shared with the
sign-in flow.

#### 3.2 The connector substrate — designed so a 50th connector is a seed row

A generic framework, not per-vendor tables (`integrations.providers` + `user_connections` +
`connection_secrets` + `connection_sync_state` + `webhook_subscriptions` + `webhook_deliveries` +
`connection_audit`). The variability lives in `providers.auth_config` and adapter code, not the
schema.

- **Category vs. capability are two axes.** `providers.category` is the coarse UI family (one value);
  `providers.capabilities` (`provider_kind[]`) is the fine-grained thing a connection may _do_ and
  the **unit of consent** — a user may grant `calendar` but not `storage` at one vendor. Calendar
  sync and conferencing stay distinct (`INTEGRATION_SOURCES` vs. `CONFERENCING_PROVIDERS` in
  `@projective/types/scheduling`).
- **The connection is a state machine, not a token.** `pending → active → degraded → expired /
  revoked / disconnected`. The settings UI surfaces **reconnect** for recoverable states — a dead
  token that silently stops syncing is the classic connector-platform support fire.
- **Multiple accounts per vendor.** The unit is `(user, provider, external_account_id)`, so a user
  can connect a personal and a work Google without a later migration.
- **The token vault is split and KMS-backed.** Secrets live in `connection_secrets` (a separate
  table, **no policy, no view, service-role only**) under **envelope encryption** — a per-record
  data key wrapped by a KMS master key (`key_id`), not a symmetric secret in an env var.
  `user_connections` itself is definer-only; clients read `v_my_connections`, which cannot project a
  token. Safety is **structural, not a policy**.
- **Webhooks are a distributed-systems problem.** Provider push channels are registered rows with a
  first-class `expires_at` a cron re-registers before it lapses; inbound pushes dedupe on
  `webhook_deliveries (provider_slug, external_delivery_id)` and record signature verification. Same
  idempotency discipline as `comms.delivery_events`.
- **Integration strategy is recorded per provider (`broker`).** **Calendar → a unified API (Nylas)**
  — recurrence/timezone/webhook-renewal is a solved-elsewhere nightmare not worth re-owning.
  **Storage/developer → direct** (a unified file API is too leaky). **CRM long tail → a unified
  broker (Merge)** where adapter-per-vendor stops paying off. The broker is **always wrapped behind
  our own adapter interface**, so it stays a replaceable implementation detail.
- **MVP is read-only inbound.** `sync_direction` defaults `inbound`; `bidirectional` is a per-connector
  project (echo-suppression + conflict resolution), never the default.
- **Capability checks never touch credentials.** `fn_has_capability(user, kind)` /
  `fn_conferencing_provider(user)` return a boolean / a slug. A NULL provider is a **normal** answer —
  a user who connected nothing is still bookable (falls back to a platform room / manual link).

#### 3.3 The Edge-Function moving parts (deferred, deliberately)

The schema is the durable half; the runtime is Edge Functions (code, not migrations) and is where
the real engineering is: the consent handshake (authorize → callback → envelope-encrypt →
`user_connections` + audit line), a **proactive token-refresh scheduler** (refresh _before_ expiry,
not lazily on 401 — Google tokens lapse if unused ~6 months, Microsoft rotates every refresh),
webhook ingestion + channel renewal, canonical-model sync adapters into `scheduling.events`, and
per-user + global rate limiting. See [`integrations/Functions.md`](../database/integrations/Functions.md).

#### 3.4 The plugin ecosystem — "Projective OS" (post-MVP, schema laid now)

Third-party code (Shopify/Figma/Obsidian-class) injected into governed extension points. Deferred by
roadmap, but the schema + the three retrofit-killing **seams** are laid down now so the later build
is not a rewrite (`extension_points`, `plugin_scopes`, `plugins`, `plugin_versions`,
`plugin_installations`, `plugin_grants`, `plugin_audit`).

- **The trust model is adversarial — Figma/Shopify, not Obsidian.** A plugin touches other people's
  client data and money, so third-party code **never runs in the host origin**. UI injects via a
  **sandboxed cross-origin iframe** (`plugin_versions.bundle_url` on a separate origin, SRI-pinned by
  `bundle_integrity`) talking to the host over a typed `postMessage` bridge, or via a **declarative
  (Block-Kit-style) descriptor** the host renders with `@projective/ui`. **Shadow DOM is a styling
  boundary, not a security one** — it is never the isolation mechanism.
- **Every data touch is capability-scoped.** `plugin_scopes` is the permission vocabulary (as data),
  a version's manifest requests a subset, the user consents (`plugin_installations.granted_scopes`),
  and a server-side **Plugin-API mediator** enforces it via `fn_plugin_has_scope` on every call — a
  plugin never touches the DB directly. This is the **same consent machinery as connection scopes**:
  a plugin is a first-party OAuth client with extra UI rights.
- **The three seams that make it retrofittable are already true today.** (1) The thin-routes /
  fat-services boundary — an island calling `/api/*` is indistinguishable from a plugin calling
  `/api/*`, so **anything a plugin could call already goes through the HTTP API**, never a direct
  service import. (2) `extension_points` mirrors the app's own URL-keyed slot resolvers
  (`channelHeaderFor`, `laneFor`, `middleNavFooterFor`) — first-party and plugin slots share one
  registry. (3) The token-only, BEM design-system contract is what makes the declarative plugin-UI
  tier possible (plugins emit `@projective/ui` descriptors, not arbitrary CSS).
- **Not built now:** the SDK/CLI, GitHub-repo plugin loading, the review/publish pipeline, the
  marketplace, revenue share. All post-PMF. **AI workflows/automation agents** ride the _same_
  capability-scoped Plugin API — an agent is a `headless` plugin with programmatic scopes.

#### 3.5 Agent-authored messages — the roadmap (NOT BUILT; Decision #155)

No autonomous agent, agent workflow or agent identity exists in code or schema, and none is to be
built ahead of this plan. When agents arrive they act FOR a person and are attributable to them:

- **One actor axis on a message.** `comms.project_messages` (and `comms.dm_messages`) gain
  `actor_kind text NOT NULL DEFAULT 'human' CHECK (actor_kind IN ('human', 'agent_assisted',
  'autonomous_agent'))`, edited in place in `00000016` with its `@projective/types` schema and
  `database/comms/Tables.md` in the same change (root `CLAUDE.md` §1). `sender_user_id` stays the
  accountable, delegating PERSON in every case — there is no synthetic agent user — and a nullable
  `actor_plugin_id → integrations.plugins(id)` names the agent.
- **Agents are `headless` plugins.** A procurement bot or a delegated assistant is an
  `integrations.plugins` row with `runtime = 'headless'` (the enum value exists today), installed
  and consented like any plugin, its every write mediated by `fn_plugin_has_scope` — never a direct
  database client.
- **Indicated, never disguised.** Every message reader (the feed, inbox previews, notifications)
  renders a non-`human` row with a Meta-register indicator ("Sent by an assistant", with the plugin's
  name on demand) — never a pill (DESIGN_SYSTEM §B.11) and never omitted. The PII mask, the reply
  guard and the edit window apply unchanged, because they govern the words, not the author.

_The `integrations` connection store was originally described under Conferencing §2.1 (2026-07-24);
this §3 supersedes and generalises it — Conferencing is now one consumer of §3._

### 4. Discovery & courtesy calls (`scheduling` schema, 2026-07-24)

Migrations `20260724100000`–`20260724104000` add the twelfth schema, `scheduling`, and with it the
pre-engagement booking layer. See [`PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) §Discovery &
Courtesy Calls for the business rules and
[`documentation/database/scheduling/`](../database/scheduling/Tables.md) for the schema.

- **Why a new schema.** `@projective/types/scheduling` has described itself as a read projection
  "over the eventual `scheduling.*` tables" since 2026-07-21, but the schema did not exist. This
  materialises it. `projects.session_events` / `cohorts` / `session_attendance` remain the SSOT for
  a **paid Session Service's delivery** and are untouched; a `scheduling.events` row may *mirror*
  one for calendar rendering via `source_session_event_id`.
- **The booking rules live in the database.** They protect a person's calendar and (for a paid
  call) their money, so they are enforced where RLS is. `scheduling.fn_call_request_refusal` returns
  **NULL or a reason code**, and the *same* function backs both the pre-flight UI check and the
  `BEFORE INSERT` trigger — so the two can never drift, and a hand-rolled PostgREST insert cannot
  bypass the gate. The legal-transition matrix is likewise a trigger, not a policy.
- **Enforcement skips service-role.** Both triggers no-op when `auth.uid()` is NULL: webhooks,
  sweeps and backfills own the rules in their own layer. The triggers guard the *client* path.
- **Shape is public, content is not.** A published schedule exposes its bands, blackout **spans**
  and occupied **spans** to `anon` — a visitor must see when someone is free to book them — and
  nothing else about what occupies it. Since 2026-09-28 a visitor reads no `scheduling.events` or
  `blackout_dates` row at all: occupancy comes only through the definer `scheduling.get_free_busy`
  (bare start/end pairs) and blackouts through `scheduling.get_public_blackouts`, which masks a
  label to `Unavailable` unless the owner opted in (`label_is_public`) — because a row policy cannot
  mask a column, and the one that stood there handed a guest every busy block's title and every
  private label. A schedule is public only while its owner's profile is visible too
  (`fn_schedule_is_public`), and an event's meeting room is withheld from every client role at the
  column level and read by its parties through `scheduling.get_event_rooms`. See
  [`documentation/database/scheduling/Policies.md`](../database/scheduling/Policies.md).
- **A discovery call is a `booking`, not a tenth `CalendarEventKind`.** Adding a kind would break
  the shipped calendar engine's exhaustive `Record<CalendarEventKind, …>` maps, turning a data
  change into a design-system change (root `CLAUDE.md` §3).
- **⚠️ Paid calls have no escrow path yet.** `finance.escrows` requires `project_stage_id` NOT NULL,
  so a standalone 1-1 paid call between an individual client and a freelancer has no legal escrow
  row. (The payer is no longer the blocker: since Decision #126 `payer_business_id` is nullable and
  `ck_escrows_one_payer` admits an individual `payer_user_id` instead — re-confirmed in Decision #165.) `discovery_calls.escrow_id` is nullable and set only when a
  call attaches to an already-funded stage. Relaxing those columns (a **protected** table) or
  auto-provisioning a session-format micro-project both need human sign-off — flagged, not chosen.

---

## Testing Protocols

Testing is mandatory and must use the native Deno test runner (`Deno.test`).

- **Controllers (Routes):** Integration tests using mock HTTP requests to verify correct status
  codes and Zod payload validation.
- **Services (Logic):** Unit tests that mock the Supabase client to ensure financial math (Escrow
  splits) and Workload Intensity ($W_i$) algorithms are flawless.
- **Islands (UI):** DOM testing using Preact Testing Library to verify that signal changes correctly
  update the DOM without full re-renders.

---

## Environment Variable Contract

The application relies on a strict set of environment variables. The canonical scaffold is
[`.env.example`](../../.env.example) at the repository root, which uses exactly these keys.

> **Two value conventions, and they are not interchangeable.** Every secret is `XXXX-XXXX` (root
> `CLAUDE.md` §6 — a real key is never committed). Every `*_BACKEND_LIVE` gate carries its literal
> **default, `false`**, because it is a boolean parsed by `serverEnv()` as
> `(value ?? "false").toLowerCase() === "true"` — an `XXXX-XXXX` there is not a redacted secret, it is
> a value that silently parses as `false` while *looking* configured.

> **Where real values go.** `apps/web/main.ts` loads exactly two files from the repo root —
> `.env.local` first, then `.env` (`@std/dotenv` `export: true` never overwrites, so the first file
> and the process environment win). `.env.development` / `.env.production` are **not** loaded by the
> app. Secrets belong in `.env.local`. **`.env.example` is the only committed env file**: `.env`,
> `.env.local`, `.env.development` and `.env.production` are git-ignored and untracked
> (Decision #125(i)), so a fresh clone starts by copying `.env.example` to `.env.local`. No
> `deno task`, script or CI job reads a tracked env file. The Supabase CLI resolves `env(...)` in `supabase/config.toml`
> (Google sign-in, Twilio, Apple, S3) from the process environment and the dotenv files it finds in
> `supabase/` and the repo root, `.env.local` included.

> **Outbound email — none configured yet (Decision #57(f), #151).**
> `packages/backend/services/mail/verification-mailer.ts` is the only seam an email-verification link
> leaves through. With no transport configured, development logs
> `[dev mail] Verify <address> -> ${APP_URL}/api/user/emails/verify?token=…` and reports
> `delivery: "logged"`; under `DENO_ENV=production` nothing is sent, a warning is logged WITHOUT the
> token, and `delivery` is `"unavailable"` (the address is saved unverified and the UI says so).
> `APP_URL` builds the link, so it must be the public origin anywhere deployed. A provider lands as a
> key in this contract plus `core/env.ts`, returned from `configuredTransport()`.

```env
# Application
DENO_ENV=development
APP_URL=http://localhost:3000   # defaults to http://localhost:$PORT
PORT=3000                       # dev server port; per-machine overrides go in the untracked .env.local

# Supabase (Database & Auth)
SUPABASE_URL=XXXX-XXXX
# Optional: the origin a browser reaches Supabase on, when it differs from SUPABASE_URL. Every public
# storage URL (avatars, banners, listing covers) is built from it (`core/storage-url.ts`).
SUPABASE_PUBLIC_URL=XXXX-XXXX
SUPABASE_ANON_KEY=XXXX-XXXX
SUPABASE_SERVICE_ROLE_KEY=XXXX-XXXX
# Legacy HS256 JWT secret, server-only: verifies an HS256 access token (`core/access-token.ts`). A
# project on asymmetric keys (the local CLI stack) verifies against its JWKS and needs none.
SUPABASE_JWT_SECRET=XXXX-XXXX

# Authentication (OAuth) — SIGN-IN only; GoTrue owns this and retains no API token
GOOGLE_CLIENT_ID=XXXX-XXXX
GOOGLE_CLIENT_SECRET=XXXX-XXXX

# Integrations (connection OAuth) — a SEPARATE consent that stores a long-lived API grant.
# Never share a client or a token store with the sign-in credentials above.
# Calendar sync + conferencing; each provider ships DISABLED until its credentials exist.
GOOGLE_INTEGRATION_CLIENT_ID=XXXX-XXXX
GOOGLE_INTEGRATION_CLIENT_SECRET=XXXX-XXXX
MICROSOFT_INTEGRATION_CLIENT_ID=XXXX-XXXX
MICROSOFT_INTEGRATION_CLIENT_SECRET=XXXX-XXXX
ZOOM_CLIENT_ID=XXXX-XXXX
ZOOM_CLIENT_SECRET=XXXX-XXXX
ZOOM_WEBHOOK_SECRET=XXXX-XXXX

# Storage connectors (asset management) — each is a SEPARATE consent from sign-in and from the
# calendar/conferencing grants above. Google Drive reuses GOOGLE_INTEGRATION_* (one connection,
# two capabilities: `storage` + `calendar`); the rest need their own app credentials.
DROPBOX_CLIENT_ID=XXXX-XXXX
DROPBOX_CLIENT_SECRET=XXXX-XXXX
FRAMEIO_CLIENT_ID=XXXX-XXXX
FRAMEIO_CLIENT_SECRET=XXXX-XXXX
# S3-compatible (AWS S3, R2, B2, MinIO …) — the one connector with NO authorization server, so the
# credential is a static key pair. Endpoint / region / bucket / prefix are NOT secrets and are stored
# per connection in integrations.user_connections.config, never here.
S3_ACCESS_KEY_ID=XXXX-XXXX
S3_SECRET_ACCESS_KEY=XXXX-XXXX

# Link safety — a Google Safe Browsing v4 Lookup API key (files/link-reputation.ts), read at call
# time and never inlined; absent or the placeholder → no reputation lookup (the scan's own guards
# still run). The lookup sends the full URL to Google (Decision #128).
LINK_SAFETY_API_KEY=XXXX-XXXX

# Discovery embeddings — Voyage AI voyage-4 (Decision #179). EMBEDDINGS_ENABLED is a boolean, default
# false like the gates below: off, discovery ranks heuristically and nothing calls Voyage. In
# development the Dev Context Switcher overrides it per browser (`pj.dev.embeddings`); production
# never reads that cookie. The key is a secret, server-only. An Atlas model API key is answered by
# https://ai.mongodb.com, a Voyage platform key (pa-…) by https://api.voyageai.com; the client picks
# the host from the key unless VOYAGE_API_BASE names one. `db:reset` leaves every vector empty — run
# `deno task embeddings:backfill` after it.
EMBEDDINGS_ENABLED=false
VOYAGE_API_KEY=XXXX-XXXX
# VOYAGE_API_BASE=https://ai.mongodb.com

# Stripe (Finance) — read only by packages/backend/core/stripe.ts; a value not shaped like its key
# (sk_/rk_, whsec_, pk_) counts as absent, so the placeholder degrades to "not connected here".
# A LIVE key (sk_live_/rk_live_) with DENO_ENV other than "production" stops the server at boot
# (assertStripeKeyAllowed, called from apps/web/main.ts). Locally, put test keys in .env.local only.
STRIPE_SECRET_KEY=XXXX-XXXX
STRIPE_WEBHOOK_SECRET=XXXX-XXXX
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=XXXX-XXXX
# The signing secret of the SECOND event destination, /api/finance/webhooks/stripe-v2 (Accounts v2 thin
# events). Absent → that endpoint answers 503 and v2 capability changes are picked up by account.updated.
STRIPE_THIN_WEBHOOK_SECRET=XXXX-XXXX
# The signing secret of the CONNECT event destination (events on connected accounts: payout.paid,
# payout.failed, account.updated). It may share /api/finance/webhooks/stripe, which verifies against
# either secret (Decision #202). Absent → those deliveries are refused as unsigned.
STRIPE_CONNECT_WEBHOOK_SECRET=XXXX-XXXX
# Bearer token (≥ 32 characters) the scheduler presents to POST /api/finance/cron/deposits and
# POST /api/finance/cron/payouts; anything else — including an unset secret — gets a 404, so the
# endpoints do not advertise that they exist.
FINANCE_CRON_SECRET=XXXX-XXXX
# Bearer token (≥ 32 characters) the scheduler presents to POST /api/user/cron/erasures, which runs the
# account and freelancer-profile erasures that have come due (Decision #156); 404 otherwise.
ACCOUNT_CRON_SECRET=XXXX-XXXX
# Bearer token (≥ 32 characters) the scheduler presents to POST /api/scheduling/cron/horizon, which
# recompiles availability presets running short of their occurrence horizon (Decision #217); 404 otherwise.
SCHEDULING_CRON_SECRET=XXXX-XXXX
# Bearer token (≥ 32 characters) the scheduler presents to POST /api/contact/cron/attachments, which
# deletes /contact attachments nobody sent (Decision #276); 404 otherwise.
CONTACT_CRON_SECRET=XXXX-XXXX
# Scheduled jobs (§Scheduled jobs, Decision #203) — these are SUPABASE VAULT secrets, not app env keys.
# pg_net reads them inside the database to call the routes above; set them per environment with
#   SELECT vault.create_secret('<value>', '<NAME>');   -- vault.update_secret(id, '<value>') to rotate
# and never in a migration or a seed. Until they exist, each http job skips and logs instead of running.
#   CRON_APP_URL         the origin the DATABASE reaches the app on (public APP_URL when hosted;
#                        http://host.docker.internal:<PORT> locally)
#   FINANCE_CRON_SECRET  the same value as the env key above
#   ACCOUNT_CRON_SECRET  the same value as the env key above
#   SCHEDULING_CRON_SECRET  the same value as the env key above
#   CONTACT_CRON_SECRET  the same value as the env key above
# Optional, development only: stripe-mock origin; ignored for live keys and under DENO_ENV=production
# STRIPE_API_BASE=http://localhost:12111

# Security
ENCRYPTION_KEY=XXXX-XXXX # 32-byte hex for Edge Function/Vault encryption
# ⚠️ See §Asset Management → The token vault: ENCRYPTION_KEY (one symmetric process-wide secret) and
# the KMS envelope the `integrations` schema was built for (connection_secrets.key_id) are two
# different designs. Unresolved — a human picks one (§8 Decision #59).
KMS_KEY_ALIAS=XXXX-XXXX          # the KEK the token vault wraps DEKs under

# Backend live gates — booleans, default false. Each flips ONE fat service from its deterministic
# fixtures to its live Supabase path. They are separate switches on purpose: a half-wired query, a
# half-wired money mutation and a half-wired outbound call carrying someone else's token are three
# different kinds of accident.
AUTH_BACKEND_LIVE=false
EXPLORE_BACKEND_LIVE=false
NEWSLETTER_BACKEND_LIVE=false
PROJECTS_BACKEND_LIVE=false
PROFILE_BACKEND_LIVE=false
MESSAGING_BACKEND_LIVE=false
CATALOGUE_BACKEND_LIVE=false
LOGGING_BACKEND_LIVE=false
FINANCE_BACKEND_LIVE=false
# (No WORKSPACE_BACKEND_LIVE: the Teams & Businesses console is live-only since 2026-09-28, like the
# profile — there is no fixture branch left for a gate to choose.)
FILES_BACKEND_LIVE=false
INTEGRATIONS_BACKEND_LIVE=false
# Platform-authored content — the help centre, the changelog, Projective's articles (Decision #274).
# Off, each answers from its Zod-validated content source through the same row parse and mapping the
# live read uses (the source is also what `deno task db:editorial:generate` writes into the seed
# migrations), so turning it on changes where the rows are read from, not what they say.
EDITORIAL_BACKEND_LIVE=false
# User-generated community activity — helpfulness votes and the feedback board (Decision #274). A
# write surface open to signed-out visitors; off, it answers fixtures and writes nothing. The
# newsletter, also in `community`, keeps NEWSLETTER_BACKEND_LIVE. Both schemas must be in
# supabase/config.toml [api].schemas (then `supabase stop && supabase start`) or a hosted project's
# Exposed schemas before either gate, or the newsletter's live path, can reach them.
COMMUNITY_BACKEND_LIVE=false
# The /contact intake (Decision #276): ops.contact_requests through ops.submit_contact_request, and
# attachments through the quarantine pipeline into the private `contact` bucket. Off, development
# answers a receipt and stores nothing; PRODUCTION REFUSES (503) rather than acknowledge a message
# nobody will read — set it in every deployed environment.
CONTACT_BACKEND_LIVE=false
```

---

## Restructure Change Log (July 2026)

This file is a **verbatim move** of the former `brain2.md` with exactly two governed edits. Nothing
else — no directive, no rule, no code block — was altered, softened, or dropped.

1. **Renamed** `documentation/business/brain2.md` →
   `documentation/architecture/SYSTEM_ARCHITECTURE.md`. A redirect stub remains at the old path so
   existing references keep resolving.
2. **§2 UI sub-path taxonomy updated** from the former `atoms/fields/charts/data/time/files/system`
   split to the seven professional taxonomies now declared in `packages/ui/deno.json`:
   `layout / navigation / fields / display / feedback / overlay / utils`. The old aliases are marked
   deprecated shims.
3. **§3 gained the Material You theming-engine exception** — `@material/material-color-utilities` is
   an approved, tightly-scoped exception to "zero UI-library dependencies," usable **only** by
   `packages/ui/system/` to emit CSS custom properties. Components remain library-agnostic.

The full component roster, the token contract, the `<DesignSystemProvider>` context engine, and the
navigation-shell spec live in
[`documentation/design-system/DESIGN_SYSTEM.md`](../design-system/DESIGN_SYSTEM.md).
Product-management hierarchy and lifecycle live in
[`documentation/PRODUCT_MANAGEMENT.md`](../PRODUCT_MANAGEMENT.md).
