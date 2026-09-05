import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeliveryPreview } from "@/features/emails/ui/delivery-preview";
import { de } from "./helpers";

/**
 * The rerendered email on the detail page (spec 0006, AC-9): the HTML sits in a fully sandboxed
 * frame (no scripts, no navigation, no same origin access) and a failed render shows an explained
 * empty state. The server side translator is the boundary; it reads the German catalog here.
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) => {
    const path = `${namespace}.${key}`.split(".");
    return path.reduce<unknown>(
      (node, segment) => (node as Record<string, unknown> | undefined)?.[segment],
      de,
    ) as string;
  },
}));

describe("DeliveryPreview (AC-9)", () => {
  it("shows the rendered HTML in a frame with an empty sandbox and a title", async () => {
    render(
      await DeliveryPreview({
        preview: { ok: true, subject: "Willkommen", html: "<p>Guten Tag Clara</p>" },
      }),
    );
    const frame = screen.getByTitle(de.emails.preview.frameTitle);
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("srcdoc", "<p>Guten Tag Clara</p>");
    expect(screen.getByText(de.emails.preview.description)).toBeInTheDocument();
  });

  it("explains a template the registry no longer knows, with no frame", async () => {
    render(await DeliveryPreview({ preview: { ok: false, error: "unknown_template" } }));
    expect(screen.getByText(de.emails.preview.unknownTemplate)).toBeInTheDocument();
    expect(screen.queryByTitle(de.emails.preview.frameTitle)).not.toBeInTheDocument();
  });

  it("explains a render failure, with no frame", async () => {
    render(await DeliveryPreview({ preview: { ok: false, error: "render_failed" } }));
    expect(screen.getByText(de.emails.preview.renderFailed)).toBeInTheDocument();
    expect(screen.queryByTitle(de.emails.preview.frameTitle)).not.toBeInTheDocument();
  });
});
