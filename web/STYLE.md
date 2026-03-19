# Style Guide

## CSS Variables

All colors use CSS custom properties defined in `src/routes/+layout.svelte`. Three theme modes: System (default), Light, Dark.

### Backgrounds
| Variable | Usage |
|----------|-------|
| `--bg-primary` | Page background, main content areas |
| `--bg-secondary` | Cards, panels, nav, modals, detail sections |
| `--bg-tertiary` | Nested elements, badge backgrounds |
| `--bg-hover` | Hover states on rows/items |
| `--bg-nav` | Navigation bar |

### Borders
| Variable | Usage |
|----------|-------|
| `--border` | Primary borders (tables, sections, cards) |
| `--border-light` | Lighter borders (inputs, secondary elements) |

### Text
| Variable | Usage |
|----------|-------|
| `--text-primary` | Body text, headings |
| `--text-secondary` | Labels, metadata, secondary info |
| `--text-muted` | Hints, placeholders, dimmed text |

### Status Colors
| Variable | Usage |
|----------|-------|
| `--success` / `--success-bg` | Positive values, success messages |
| `--danger` / `--danger-bg` | Negative values, errors, delete actions |
| `--warning` / `--warning-bg` | Caution, in-progress states |
| `--accent` | Links, active states, primary accent |
| `--purple` / `--purple-bg` | Share actions |

### Inputs & Buttons
| Variable | Usage |
|----------|-------|
| `--input-bg` / `--input-border` | Form inputs and selects |
| `--btn-primary-bg` / `--btn-primary-hover` | Primary action buttons (green) |
| `--btn-secondary-bg` / `--btn-secondary-border` | Secondary buttons |
| `--modal-backdrop` / `--modal-bg` | Modal overlay and content |
| `--card-bg` / `--card-border` | Card containers |

## Global Utility Classes

Defined in `+layout.svelte`, available everywhere:

```css
.pos        /* color: var(--success) — positive values */
.neg        /* color: var(--danger) — negative values */
.muted      /* color: var(--text-secondary) */
.mono       /* font-family: monospace */
.msg-success  /* green success message block */
.msg-error    /* red error message block */
```

Global base styles are applied to `select`, `input[type="text"]`, `input[type="number"]`, etc.

## Components

### Modal (`$lib/components/Modal.svelte`)

```svelte
<Modal show={!!target} title="Delete item?" onclose={() => target = null}>
  <p class="modal-warning">This cannot be undone.</p>
  <div class="modal-actions">
    <button class="btn-action" onclick={() => target = null}>Cancel</button>
    <button class="btn-primary btn-danger" onclick={doDelete}>Delete</button>
  </div>
</Modal>
```

### MonacoEditor (`$lib/components/MonacoEditor.svelte`)

```svelte
<MonacoEditor bind:value={source} types={editorTypes} onchange={() => dirty = true} onsave={save} />
```

Supports light/dark themes reactively.

## Utilities (`$lib/utils.ts`)

| Function | Example Output |
|----------|---------------|
| `formatDate(iso)` | "Mar 19, 2:30 PM" |
| `formatPct(n)` | "+12.3%" |
| `formatPnl(n)` | "+1.23" |
| `formatFileSize(bytes)` | "14.2 KB" |
| `formatDuration(ms)` | "4h 8m" |

## SSE (`$lib/sse.ts`)

```svelte
onMount(() => {
  return connectSSE("/api/live/stream", (data) => {
    sessions = data.sessions;
  });
});
```

Auto-reconnects with exponential backoff. Return value is the cleanup function — pass directly from `onMount`.

## Spacing

Standard spacing values: `4px`, `6px`, `8px`, `10px`, `12px`, `16px`, `24px`, `32px`.

- Component padding: `12px 16px` or `16px 20px`
- Gap between items: `8px` (tight), `12px` (normal), `16px` (loose)
- Section margins: `12px` (related), `24px` (separate sections)

## Typography

- Page titles: `h1` at `1.4em`
- Section headers: `h2` at `1em-1.1em`, color `--text-secondary`, bottom border
- Subsections: `h3` at `0.95em`
- Body text: inherited `0.9em`
- Small/metadata: `0.82em-0.85em`
- Monospace: file names, code, granularity labels

## Button Patterns

| Class | Usage |
|-------|-------|
| `.btn-primary` | Main actions (Run, Start, Save) — green |
| `.btn-primary.btn-danger` | Destructive confirms (Delete) — red |
| `.btn-primary.btn-warn` | Caution confirms (Revert) — yellow |
| `.btn-action` | Secondary actions (Cancel, Fork) — outlined |
| `.btn-link` | Inline text actions (Rerun, HTML, CSV) — looks like a link |
| `.btn-share` | Share action — purple |
| `.btn-stop` | Stop session — red outlined |

## Table Patterns

- Headers: `color: var(--text-secondary)`, bottom border `2px solid var(--border)`
- Rows: bottom border `1px solid var(--border)`, hover `var(--bg-hover)`
- Expandable: click row to toggle `.detail-row` with `.detail-panel` containing `.detail-section` + `.detail-grid`
- Chevron column: `▸` / `▾` for expand/collapse

## Message Blocks

```svelte
{#if message}
  <div class="msg-success">{message}</div>
{/if}
{#if error}
  <div class="msg-error">{error}</div>
{/if}
```

Override `margin-bottom` locally if the default `12px` doesn't fit (some pages use `16px`).
