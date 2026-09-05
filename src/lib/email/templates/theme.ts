/**
 * The email face of the design system (spec 0006, AC-14). Email clients read inline values, not
 * CSS custom properties, so the brand constants of `src/app/globals.css` are mirrored here once:
 * jet on white, one typeface first in the stack, square corners, hairline dividers. Keep the two
 * in step when the brand values change. Pure data, used only by the templates.
 */
export const EMAIL_THEME = {
  colors: {
    jet: "#000000",
    pureWhite: "#ffffff",
    obsidian: "#141414",
    muted: "#5c5c5c",
    hairline: "#e5e5e5",
    ground: "#f4f4f4",
  },
  fontFamily: 'Geist, "Helvetica Neue", Helvetica, Arial, sans-serif',
  monoFamily: '"Geist Mono", Menlo, Consolas, monospace',
  radius: "2px",
  width: 560,
} as const;
