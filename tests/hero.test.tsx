import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { Hero } from "@/features/marketing/hero";
import de from "../messages/de.json";
import en from "../messages/en.json";

// The App Router is not mounted in jsdom; next-intl's Link only needs these hooks to exist.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

describe("landing hero (AC-1)", () => {
  it("renders German copy for de", () => {
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <Hero />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(de.landing.title);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/de/sign-in");
  });

  it("renders English copy for en", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <Hero />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(en.landing.title);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/en/sign-in");
  });
});
