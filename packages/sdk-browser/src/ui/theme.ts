// implementation-plan.md §3: the widget's theme tokens. Every colour, font and shadow the widget draws
// with is a `--ann-*` custom property on the shadow root's host, so a site can match its own palette
// (a rule such as `[data-rw="annotatie"] { --ann-accent: #7c3aed }` on the host page wins over these).
// The default theme is neutral; RW-1's Race Officials colours are one preset.

export type ThemeName = "neutral" | "race-officials";

/** Status tones and shapes shared by both presets (RW-1's palette pairs, measured for contrast). */
const COMMON: Record<string, string> = {
  "success-text": "#06773c", "success-bg": "#e4ffea", "success-border": "#0e994f", "success-icon": "#0e994f", "success-tint": "#e7f8ed", "success-subtle": "#9cfdb7",
  "warning-text": "#855903", "warning-bg": "#fff5e8", "warning-border": "#ab7408", "warning-icon": "#ab7408", "warning-tint": "#fcf2e3", "warning-subtle": "#ffddb0",
  "danger-text": "#93060f", "danger-bg": "#fff4f2", "danger-border": "#ba0e17", "danger-icon": "#ba0e17", "danger-tint": "#ffefee", "danger-subtle": "#fed9d4",
  "info-text": "#0a6d8c", "info-bg": "#edf9ff", "info-border": "#018db4", "info-icon": "#018db4", "info-tint": "#e5f7fd", "info-subtle": "#beebfe",
  "on-solid": "#ffffff",
  "radius-sm": "4px", "radius-md": "6px", "radius-lg": "8px", "radius-xl": "12px", "radius-sheet": "16px", "radius-full": "9999px",
  "shadow-xs": "0 1px 2px rgb(0 0 0 / 0.05)",
  "shadow-lg": "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  "btn-primary-border": "rgb(0 0 0 / 0.10)", "btn-primary-highlight": "rgb(255 255 255 / 0.20)",
  "backdrop": "rgb(0 0 0 / 0.10)", "viewer-backdrop": "rgb(0 0 0 / 0.35)",
};

export const THEMES: Record<ThemeName, Record<string, string>> = {
  neutral: {
    ...COMMON,
    "accent": "#18181b", "accent-hover": "#3f3f46", "accent-fg": "#ffffff", "link": "#1f2937",
    "surface": "#ffffff", "surface-sunken": "#fafafa", "surface-hover": "#f4f4f5",
    "text": "#27272a", "text-data": "#3f3f46", "text-muted": "#71717a", "text-muted-strong": "#52525b",
    "border-divider": "#e4e4e7", "border-control": "#8a8a93", "border-chrome": "#d4d4d8",
    "selection": "#f0f9ff", "selection-bar": "#0277a8", "focus-ring": "#18181b",
    "label-bg": "#18181b", "skeleton": "#f4f4f5", "ghost-hover": "rgb(24 24 27 / 0.05)",
    "tag-neutral-bg": "#f1f1f3", "tag-neutral-text": "#27272a", "tag-neutral-border": "#71717a",
    "font-sans": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    "font-heading": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  },
  "race-officials": {
    ...COMMON,
    "accent": "#0d2c6c", "accent-hover": "#25417b", "accent-fg": "#ffffff", "link": "#0d2c6c",
    "surface": "#ffffff", "surface-sunken": "#f7faff", "surface-hover": "#ecf4ff",
    "text": "#1c2735", "text-data": "#354150", "text-muted": "#677485", "text-muted-strong": "#495565",
    "border-divider": "#d9e8fb", "border-control": "#808d9f", "border-chrome": "#c7d6e8",
    "selection": "#eff9fd", "selection-bar": "#0889ae", "focus-ring": "#0d2c6c",
    "label-bg": "#0f1926", "skeleton": "#ecf4ff", "ghost-hover": "rgb(28 39 53 / 0.05)",
    "tag-neutral-bg": "#eff1f4", "tag-neutral-text": "#1c2735", "tag-neutral-border": "#677485",
    "font-sans": 'Inter, ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif',
    "font-heading": 'Jost, Inter, ui-sans-serif, system-ui, Arial, sans-serif',
  },
};

export function themeName(value: string | null | undefined): ThemeName {
  return value === "race-officials" ? "race-officials" : "neutral";
}

/** The `:host` rule declaring the preset's tokens. */
export function themeCss(name: ThemeName): string {
  const t = THEMES[name];
  return `:host{${Object.entries(t)
    .map(([k, v]) => `--ann-${k}:${v}`)
    .join(";")}}`;
}
