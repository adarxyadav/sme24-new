import { describe, expect, it } from "vitest";
import { clientMessages, SHARED_NAMESPACES } from "@/i18n/client-messages";
import de from "../../messages/de-CH.json";

describe("clientMessages (spec 0004, AC-6)", () => {
  it("sends only the shared namespaces by default", () => {
    const picked = clientMessages(de);
    expect(Object.keys(picked).sort()).toEqual([...SHARED_NAMESPACES].sort());
    expect(picked).not.toHaveProperty("gallery");
    expect(picked.common.signIn).toBe(de.common.signIn);
  });

  it("adds the requested feature namespaces on top of the shared set", () => {
    const picked = clientMessages(de, ["gallery", "scaffold"]);
    expect(picked.gallery.title).toBe(de.gallery.title);
    expect(picked.scaffold.heading).toBe(de.scaffold.heading);
    for (const namespace of SHARED_NAMESPACES) expect(picked).toHaveProperty(namespace);
    expect(picked).not.toHaveProperty("landing");
  });

  it("names every shared namespace that exists in the catalog", () => {
    for (const namespace of SHARED_NAMESPACES) expect(de).toHaveProperty(namespace);
  });
});
