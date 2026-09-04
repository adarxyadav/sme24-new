import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "@/components/theme-provider";

// The hydration contract of the project wrapper (spec 0003, AC-3): the no flash script in the
// server HTML must run before first paint, while the script a client remount creates (a `[locale]`
// switch remounts the root layout) must stay inert so React does not warn about it.
describe("ThemeProvider", () => {
  it("keeps the no flash script executable in the server HTML", () => {
    const html = renderToString(
      <ThemeProvider>
        <p>content</p>
      </ThemeProvider>,
    );
    expect(html).toContain("<script");
    expect(html).not.toContain('type="text/plain"');
    expect(html).toContain("<p>content</p>");
  });

  it("renders the script as an inert data block on a client mount", () => {
    const { container } = render(
      <ThemeProvider>
        <p>content</p>
      </ThemeProvider>,
    );
    const script = container.querySelector("script");
    expect(script).not.toBeNull();
    expect(script).toHaveAttribute("type", "text/plain");
    expect(container).toHaveTextContent("content");
  });
});
