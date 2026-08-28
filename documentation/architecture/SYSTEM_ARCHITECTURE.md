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

- **Use Cases:** SEO keywords, user interests, organizational labels.
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
- **Options:** `variant`, `size`, `spin`, `colour` (mapped to semantic tokens like `--text-main` or
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

**GanttChart** A specialized tool for project timelines and stage management.

- **Design:**
  - **Left List:** HTML-based `GanttTaskList` for rich interactions and BEM styling.
  - **Timeline:** Canvas-based viewport supporting infinite horizontal and vertical scrolling.
  - **Header:** Dynamic "Tiered" header (Years -> Months -> Days) that adapts as you zoom via a
    slider or `Ctrl+Wheel`.
- **Features:** Supports milestones, task dependencies, and progress tracking.

**AnalyticsDisplay** A polymorphic container for data visualization that allows users to swap
between chart types without reloading data.

- **Components:** `PieChart`, `BarChart`, `LineChart`, `AreaChart`.
- **Logic:** Uses an internal `D3Orchestrator` to calculate paths and scales. The UI renders these
  as either SVG for simple charts or Canvas for datasets exceeding 1,000 points.
- **Interchangeability:** Similar to `DataDisplay`, it accepts a unified dataset and a `view`
  signal.

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

**GanttStore (Signal Store)** Manages the global state of a chart instance, including `scrollX`,
`visibleDays`, and `hoveredTask`. It calculates the `timeScale` used by all child components to map
Dates to Pixels.

**GanttManager (The Orchestrator)** Coordinates the PIXI.js application. It manages the `Ticker` for
smooth scrolling animations and triggers renderers for the Grid, Tasks, and Scrollbars.

**ThemeBridge** A critical utility that forces the browser to evaluate CSS `calc()` and `var()`
statements, returning a numeric Hex code for the Canvas engine. This ensures that when `--primary`
changes in `variables.md`, the Canvas tasks update their color instantly.

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
  at import; accepts the documented **and** the `.env.development` key names — see §8 row 11).
- `core/supabase.ts` — on-demand client provisioning: `getUserClient(jwt)` (RLS-scoped, the default)
  vs `getServiceClient()` (service-role, RLS-bypassing, narrow/audited use only), gated by
  `isSupabaseConfigured()` / `isAuthBackendLive()`.
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
(client) → `/api/explore/{search,item,related}` (thin) → `services/explore/ExploreBackendService.ts`
(fat) → `ServiceResult<T>`. The fat service owns the whole discovery query — filtering, ranking,
merged-section grouping, item lookup, and paged feed expansion — over curated fixtures
(`services/explore/fixtures.ts` + `query.ts` + the server-side `skills.ts` resolver), which the app
**never** imports. The `/explore` route and `/view/[id]` call the service directly for SSR first
paint; the `SearchDashboard` island refines client-side via `ExploreService` (filter/sort changes,
infinite-scroll pages, drawer refresh). Cross-boundary shapes — `ExploreItem`, `ExploreParams`,
`ResultGroup`, `SearchPayload`, `HomeFeed` — are the Zod SSOT at **`@projective/types/explore`**.
Stub-first behind **`EXPLORE_BACKEND_LIVE`** (default off), gated by `isExploreBackendLive()`; the
live path (Supabase discovery tables + search embeddings) slots in behind that guard.

### Newsletter services

The public footer's "stay updated" capture is the third implementation of the contract, and the
smallest write: `NewsletterService` (client) → `POST /api/newsletter/subscribe` (thin) →
`services/newsletter/NewsletterBackendService.ts` (fat) → `ServiceResult<T>`. The subscribe shape is
the Zod SSOT at **`@projective/types/newsletter`** (`NewsletterSubscribeSchema`), validated in three
places without drift: the client service (before the round-trip), the thin route (the request body),
and the fat service (defence in depth). Stub-first behind **`NEWSLETTER_BACKEND_LIVE`** (default
off), gated by `isNewsletterBackendLive()`; every well-formed address gets a friendly confirmation
while the live path (an upsert into `newsletter.subscriptions` + email-provider sync) waits behind
that guard. The footer's `NewsletterForm` island is the only client touchpoint — it `fetch`es the
route and never reaches the service.

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

### Catalogue services (the first WRITE surface)

The seller-side Catalogue (`/catalogue` + the per-item manage page `/catalogue/[id]`) is the **first
write-oriented** implementation of the contract — every prior read is now joined by create / update
/ publish mutations, all still through the same thin/fat split: `CatalogueService` (client) →
`/api/catalogue/{list,item,create,update,status}` (thin) →
`services/catalogue/CatalogueBackendService.ts` (fat) → `ServiceResult<T>`. Reads are GETs; the
mutations are JSON POSTs the fat service applies. Cross-boundary shapes — the listing LIST +
editable detail projections, the light analytics (`ListingMetrics`/`CatalogueStats`), and the
`CreateListingInput`/`UpdateListingInput`/`SetListingStatusInput` payloads — are the Zod SSOT at
**`@projective/types/catalogue`**; pricing is **not forked** (the service delivery model reuses
`ServiceType`, the display projection reuses `EntityPricing`, the per-unit prices reuse the
discovery `ticketPrice`/`sessionPrice` fields). Stub-first behind **`CATALOGUE_BACKEND_LIVE`**
(default off, gated by `isCatalogueBackendLive()`); the fat service DERIVES the seller catalogue
deterministically from the discovery corpus (re-owned to a fixed acting seller) so a listing agrees
with the `ServiceCard`/`ProductCard`/`/view/[id]` it links to, and — because this is the first write
surface — seeds those listings into an **in-module session store** so the create→edit→publish flow
is fully exercisable with the gate off (`createListing` mints an optimistic draft, `updateListing`
merges a patch, `setListingStatus` runs the publish gate). It grants **no persistence** (the store
is per-process). Seller-ness is **not a hard server-side redirect**: the client-side **Dev Context
Switcher** must be able to flip an authed dev to a seller persona at runtime, and the server never
sees that override — so the surface is authed-reachable (the `(dashboard)` middleware bounces
guests; no route gates on `isFreelancer`, per Decisions #14/#16/#48), seller-ness lives in the
dev-seam-reactive sidebar chrome, and the deferred `catalogue.*` RLS + mutation policies are the
real access gate. The publish gate (`publishReadiness`: title + a price + ≥1 media) IS enforced both
client-side (to enable/explain the Publish action) and server-side (defence in depth). The
**deferred live path** is the RLS-scoped `catalogue.*` tables + mutation policies (no DB migration
in this pass — the catalogue is a read+write projection over fixtures, like `detail`/`messages`/
`files`); it slots in behind the same gate with zero shape churn. Full feature detail is logged in
the root `CLAUDE.md` §8 Decision #53.

**`WalletBackendService`** (`services/finance/`) is the context-scoped Wallet & Finance surface
(`/wallet` + its deep pages + action modals) — the 14th thin/fat read and the finance domain's first
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
Full feature detail is logged in the root `CLAUDE.md` §8 Decision #55.

### Asset Management (`/files`) — two services, two gates

The asset hub is **two** thin/fat slices that share one screen, deliberately kept apart because they
have different trust models.

| Half             | Client (thin)         | Routes (thin)             | Service (fat)                             | Gate                        |
| :--------------- | :-------------------- | :------------------------- | :---------------------------------------- | :-------------------------- |
| The hub          | `FilesService`        | `/api/files/*` (19)       | `services/files/FilesBackendService.ts`   | **`FILES_BACKEND_LIVE`**    |
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
`createShare` · `revokeShare` · `resolveShare` · `downloadGuard` · `recordDownload` · `history`), so a
reader crossing the boundary never translates. Islands import the client service, never
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
construction. `services/files/link-scan.ts` writes the live path out so the requirements are auditable,
and keeps the outbound fetch behind `FILES_BACKEND_LIVE`; until then it answers from a stub that
touches no network. The live path must: allow `https:` only; **resolve DNS first and refuse** loopback,
link-local (including `169.254.169.254`), private, CGNAT, unique-local and unspecified ranges; **pin the
resolved address** and connect to the address that was checked (DNS rebinding); re-validate **every**
redirect hop (max 2); enforce a hard timeout (5 s) and a **stream-enforced** response cap (512 KiB —
`Content-Length` is attacker-supplied and a chunked response has none); carry **no** ambient credential
(`credentials: "omit"`, `redirect: "manual"`); and **re-host the favicon** into `public_assets` rather
than hotlinking it, because a hotlinked favicon sends every viewer's IP to a host the link's author
chose. The verdict axis keeps `unscannable` distinct from `suspicious`: *"we could not reach it"* is
not *"we found something"*.

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
| The basket  | `BasketService`    | `/api/basket/{index,item,move,promo,lists}`                          | `BasketBackendService`       |
| The flow    | `CheckoutService`  | `/api/checkout/{session,create,details,order,calendar/[orderId]/[lineId]}` | `CheckoutBackendService` |
| The wallet of cards | `CardsService` | `/api/cards/{index,[id],default}`                                  | `CardsBackendService`        |

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

⚠ **Inherited and unresolved (§8 Decision #68):** `authenticated` has no `USAGE` on the `finance`
schema, so every finance policy — old and new — is latent and nothing here can be verified against a
live database; and `platform_fee_bp` is seeded `0` while the SSOT says `500`. Both are money decisions
awaiting a human, and both are why this surface stays on fixtures behind a gate that defaults off.

### The Entity View — polymorphic archetype resolution

`/view/[entity]` is a **read** surface over `ExploreBackendService.viewPage(id)` behind
`EXPLORE_BACKEND_LIVE`, and it is the clearest instance of the slot-resolver pattern doing real
architectural work rather than layout plumbing.

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

### Sessions & Google OAuth

- **Session cookies.** A successful sign-in (password grant, verified email OTP) returns the GoTrue
  tokens on the `ServiceResult.session` envelope — never in the JSON body. The route mints canonical
  HttpOnly cookies `sb-access-token` / `sb-refresh-token` (the names the `(dashboard)` middleware
  checks) via `apps/web/utils/auth-cookies.ts`, folded in by `toAuthResponse`. Islands `fetch` the
  route, the browser stores the cookies, and the island's `location.href` navigation is
  authenticated.
- **Session lifecycle & silent refresh.** The access token is short-lived (~1h, GoTrue
  `expires_in`); the refresh token lives 30 days. A session must be **renewed**, not dropped, when
  the access cookie expires. The single renewal primitive is fat
  `AuthBackendService.refreshSession(refreshToken)` (live GoTrue `refreshSession({ refresh_token })`
  → rotated tokens; stub re-mints so the path is testable without a wired GoTrue — it grants no
  access, and is only reachable when a refresh cookie is actually presented). It feeds two consumers
  via `apps/web/utils/session.ts` `ensureSession(req)` — fast path (access cookie present) →
  **refresh-before-redirect** (access gone + refresh present → renew in place) → **fail-closed**
  (spent/invalid refresh → clear both cookies):
  - **Server (the `(dashboard)` guard).** `routes/(dashboard)/_middleware.ts` calls `ensureSession`,
    re-mints the renewed `sb-*` cookies onto the proceeding response, re-derives
    `ctx.state.userContext` from the fresh token (so a just-renewed request never paints guest
    chrome), and — only for a genuinely dead session — redirects to `/login` capturing the **full**
    target (`pathname + search`) as `redirectTo` for a loss-free return.
  - **Client (the 401 interceptor).** `POST /api/auth/refresh` (thin, NOT behind the guard — it must
    be reachable when the access token has expired) renews the cookies via `toAuthResponse`. The
    shared `apps/web/utils/api-client.ts` `apiFetch()` wraps `fetch`: on a `401` it triggers a
    single shared refresh, retries the original request, and only routes to
    `/login?redirectTo=<path>` if the session is truly gone. Feature `api.ts` transports adopt it by
    swapping `fetch`→`apiFetch` (done for `features/projects/core/api.ts`).

  This closes session **persistence** only; real signed-JWT **verification** via `@server/services`
  (this section's remaining TODO) is where any _access_ decision must still re-validate — the guard
  and RLS remain the real gates, per root CLAUDE.md Decisions #14/#16. See Decision #46.
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
  context fallback), never a sign-in redirect.
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
  address's domain matches an existing `org.organisations` registered domain (`website`, normalised
  — scheme / `www.` / path stripped; sub-domains match), it inserts a `comms.notifications` row
  (`type: "organisation.domain_member_signup"`) for that org's active **owners/admins** so they can
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
- **Vector Encoding:** The system uses `pgvector` to store high-dimensional embeddings of text data.
- **Context-Aware Ranking:** The recommender system performs weighted vector similarity searches
  taking into account:
  - **User Context:** Preferences, interaction history, and search history.
  - **Work Context:** Project descriptions, budget constraints, and current freelancer workloads.
  - **Professional Context:** Freelancer headlines, project history, and desired budget.

### Storage Lifecycle

All file uploads follow a "Quarantine-First" protocol to protect the platform from malware and
viruses.

1. **Ingestion:** Files are initially uploaded to a `quarantine` bucket via the Supabase client.
2. **Scanning:** An Edge Function is triggered by the upload event. It scans the file for malware
   using a security provider API.
3. **Sanitization:** - **Clean:** If the file passes, the Edge Function moves it to the permanent
   destination bucket (e.g., `avatars`, `project-files`) and updates the database record.
   - **Infected:** If flagged, the file is deleted immediately, and a security log is generated.

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
(81 seeded) declaring its category, urgency, default channel fan-out, mute-ability, quiet-hours
override, dedupe window and audit flag. `comms.fn_resolve_channels` intersects that with the
recipient's global / per-category / per-type preferences, their quiet hours and their digest cadence.
Adding an event is a catalog row, not a code change in every emit site.

```
Event (RPC / trigger / cron)
  └─ comms.fn_notify ─┬─ INSERT comms.notifications ──► Supabase Realtime      (in-app)
                      ├─ INSERT comms.notification_deliveries (per channel/device)
                      │     └─ AFTER INSERT trigger ──► dispatch Edge Function (push · email · SMS)
                      └─ security.audit_logs                                    (financial/security events)
pg_cron ─ fn_process_queue · fn_escalate_unread · fn_build_digests · sweeps
```

**Boundaries that matter:**

- **The engine never raises.** `fn_notify` is invoked from inside escrow and stage RPCs; its body is
  wrapped so a notification problem can never roll back a money movement.
- **A row is always written; delivery is separate.** `comms.notifications.channels` records what the
  router decided — an empty array means "recorded, delivered nowhere". The in-app inbox reads the
  `comms.notification_feed` view, which filters on `in_app` membership.
- **Clients cannot write notifications.** There is no `INSERT` policy; rows come from the
  SECURITY DEFINER writer or the service role, so _"Payout sent"_ cannot be spoofed. The only client
  write is flipping read/seen/archived on your own row.
- **`mandatory` types bypass preferences entirely** — security, money-movement, legal and moderation
  events are not suppressible, and a `marketing_only` unsubscribe can never silence them.
- **Webhook idempotency is a unique index.** `comms.delivery_events (provider, provider_event_id)`
  is the concrete implementation of the standard above: a replayed gateway callback can never
  double-apply. Its row is never deleted — only its `raw` body is compacted after 30 days.
- **Deferred work is durable and cancellable.** `comms.notification_queue` holds promises of future
  notifications (session T-60/T-15/T-5 reminders, abandoned-basket nudges, ghosting/auto-approve
  timers) keyed by a deterministic `dedupe_key`, so re-running a scheduler is a no-op and the event
  that invalidates a reminder cancels it by key.

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

- **Auth Guards:** All routes within `./apps/web/routes/` are protected by a global `_middleware.ts`
  that validates the user's JWT before the handler is invoked.
- **Role-Based Access Control (RBAC):** Permissions are checked at the Service layer using custom
  claims within the JWT (e.g., `org_role`), ensuring that "Projective" users can only access
  resources within their authorized organizations.
- **Session Integrity:** We use secure, HTTP-only cookies for session persistence to mitigate
  XSS-based token theft.

### Row-Level Security (RLS)

RLS is mandatory for all database tables to prevent cross-tenant data leakage.

- **Tenant Isolation:** Every table containing user or organization data includes an
  `organization_id` or `user_id` column.
- **Policies:** Migration series `0200_org_rls.sql` defines strict `USING` and `WITH CHECK` clauses
  that verify the user's `auth.uid()` or `auth.jwt() -> 'org_id'` matches the row data.
- **Bypassing:** Only the service-role key (used within authenticated Edge Functions) can bypass RLS
  for administrative tasks like file scanning.

### Runtime & API Security

Deno 2.x provides a hardened environment that we strictly configure through permission manifests.

- **Sandboxing:** Our `deno.json` and task runners explicitly define permissions (e.g.,
  `--allow-net`, `--allow-env`). We never use `--allow-all` in production.
- **Input Validation:** Every API route handler uses Zod schemas from `@projective/types` to parse
  and validate request bodies before calling any Service. This prevents SQL injection and malformed
  data from reaching the logic layer.
- **Content Security Policy (CSP):** The Fresh application serves a strict CSP header that restricts
  script execution to trusted domains and the compiled WASM modules.
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
  Email/Password authentication.
- **Extensibility:** The architecture must be built to support a unified integration model later. As
  traction builds, the platform will expand to include Microsoft (Azure AD), GitHub, and Apple SSO.
- **Database Sync:** A Supabase trigger automatically creates a corresponding public `users` profile
  record whenever a new identity is registered in the `auth.users` schema.
- **Transactional emails:** GoTrue sends branded, dual-path emails from `supabase/templates/` (wired
  in `config.toml` `[auth.email.template.*]`). The **confirmation** and **recovery** templates each
  surface the **6-digit OTP** (`{{ .Token }}`, `otp_length = 6`) _and_ a magic link, matching the
  `/verify` and `/forgot-password` "type the code or click the link" flows. They are premium,
  responsive, dark-mode-aware, and image-free (inline CSS + table layout, VML buttons for Outlook).
  Note `enable_confirmations = false` for local dev (mail lands in Inbucket).

---

## Internationalization, Currency & Localization

Projective is a currency-global, locale-aware, bidirectional application. The contract is resolved
from **one source of preference** (`org.user_preferences`) and applied at read time.

### Layout direction (RtL / LtR)

- The app supports **both** left-to-right and right-to-left layouts. Direction is chosen by user
  preference (`org.user_preferences.layout_direction` — `ltr` / `rtl` / `auto`) **independent of
  language**; `auto` falls back to the natural direction of the user's `locale`.
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

- **Architecture:** We utilize **Stripe Connect Express** for Freelancers and Teams. This offloads
  KYC/AML compliance to Stripe. The platform owns the **ledger of record** (`finance.wallets` /
  `finance.transactions` / `finance.escrows` — who is owed what); Stripe owns the **fiat rails**.
- **Payment Flow:** We use **Destination Charges**. The Client’s credit card is charged
  (tap-and-pay, no client KYC), funds are held in the platform's Stripe balance (acting as Escrow),
  and upon approval, the funds are routed to the connected Express account minus the platform fee.
- **Identity & readiness (KYC/KYB):** **Stripe Identity** performs the freelancer Level-2 gov-ID /
  liveness check; **Stripe Connect** onboarding performs business KYB. The verdicts are mirrored
  into the app-owned caches (`org.freelancer_profiles.kyc_*`, `org.business_profiles.kyb_*`) and the
  `finance.verification_cases` trail — **only opaque provider references are stored, never PII**.
  The freelancer payout-ready gate (`finance.fn_freelancer_payout_ready`) is the "no forever-escrow"
  guarantee.
- **Idempotency:** every money-mutating call carries a `finance.idempotency_keys` key (and Stripe's
  own `Idempotency-Key` header) so a retried webhook or request **never double-moves money**.
- **FX:** cross-currency commits snapshot the rate used (`finance.fx_rates` → `fx_rate`/`fx_base`/
  `fx_as_of` on the ledger row) so settlement is reproducible; display conversion is read-time only.
- **Webhooks:** The `PaymentService` must listen to Stripe Webhooks (e.g.,
  `payment_intent.succeeded`, `transfer.created`, `identity.verification_session.verified`,
  `charge.dispute.created`) to update the internal `transactions` ledger, verification caches, and
  `finance.chargebacks`. Reconciliation compares the Stripe balance against the internal escrow pool
  (and `finance.v_wallet_reconciliation` checks ledger self-consistency).

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
- **Shape is public, content is not.** A published schedule exposes its bands, blackout **spans**,
  and free/busy overlay kinds to `anon` — a visitor must see when someone is free to book them —
  while syncs, milestones and bookings stay private. Blackout **labels** are withheld unless the
  owner opts in (`label_is_public`), because a policy cannot mask a column.
- **A discovery call is a `booking`, not a tenth `CalendarEventKind`.** Adding a kind would break
  the shipped calendar engine's exhaustive `Record<CalendarEventKind, …>` maps, turning a data
  change into a design-system change (root `CLAUDE.md` §3).
- **⚠️ Paid calls have no escrow path yet.** `finance.escrows` requires both `project_stage_id` and
  `payer_business_id` NOT NULL, so a standalone 1-1 paid call between an individual client and a
  freelancer has no legal escrow row. `discovery_calls.escrow_id` is nullable and set only when a
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

```env
# Application
DENO_ENV=development
APP_URL=http://localhost:8000

# Supabase (Database & Auth)
SUPABASE_URL=XXXX-XXXX
SUPABASE_ANON_KEY=XXXX-XXXX
SUPABASE_SERVICE_ROLE_KEY=XXXX-XXXX

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

# Link safety — the reputation feed a pasted link's verdict is drawn from. The provider is not yet
# chosen; the key is read at call time and never inlined (files/link-scan.ts).
LINK_SAFETY_API_KEY=XXXX-XXXX

# Stripe (Finance)
STRIPE_SECRET_KEY=XXXX-XXXX
STRIPE_WEBHOOK_SECRET=XXXX-XXXX
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=XXXX-XXXX

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
WORKSPACE_BACKEND_LIVE=false
FILES_BACKEND_LIVE=false
INTEGRATIONS_BACKEND_LIVE=false
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
