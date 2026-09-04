import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LocaleMenuItems } from "@/components/shell/locale-menu-items";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import de from "../../messages/de-CH.json";
import en from "../../messages/en-CH.json";

/** The URL the browser lands on: Next's router keeps pathname plus search, so a dangling `?` from an empty query never shows. */
function landedOn(href: unknown) {
  const url = new URL(String(href), "https://sme24.ch");
  return `${url.pathname}${url.search}`;
}

/**
 * The two language switches (spec 0004, AC-2): both keep the path and the query string, label each
 * option in its own language, and store the choice through `setLocale`. The App Router and the
 * server action are the boundaries: the router hooks answer with a fixed location and the action
 * is a spy.
 */
const boundary = vi.hoisted(() => ({
  pathname: "/de/admin/design",
  search: "x=1&tab=a&tab=b",
  replace: vi.fn(),
  setLocale: vi.fn<() => Promise<{ ok: true; data: { persisted: boolean } }>>(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => boundary.pathname,
  useSearchParams: () => new URLSearchParams(boundary.search),
  useRouter: () => ({
    push: vi.fn(),
    replace: boundary.replace,
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({ locale: "de-CH" }),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

vi.mock("@/features/localization/actions", () => ({
  setLocale: boundary.setLocale,
}));

const MESSAGES = { "de-CH": de, "en-CH": en } as const;

function renderSwitcher(locale: "de-CH" | "en-CH" = "de-CH") {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <LocaleSwitcher />
    </NextIntlClientProvider>,
  );
}

function renderMenu(locale: "de-CH" | "en-CH" = "de-CH") {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <DropdownMenu>
        <DropdownMenuTrigger>Konto</DropdownMenuTrigger>
        <DropdownMenuContent>
          <LocaleMenuItems />
        </DropdownMenuContent>
      </DropdownMenu>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  boundary.pathname = "/de/admin/design";
  boundary.search = "x=1&tab=a&tab=b";
  boundary.setLocale.mockResolvedValue({ ok: true, data: { persisted: true } });
});

describe("LocaleSwitcher, the marketing links (spec 0004, AC-2)", () => {
  it("is a navigation landmark named after the language label with one link per locale", () => {
    renderSwitcher();
    const nav = screen.getByRole("navigation", { name: de.common.language });
    expect(nav).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("keeps the path and the whole query string, repeated keys included, in both links", () => {
    renderSwitcher();
    expect(screen.getByRole("link", { name: de.common.german })).toHaveAttribute(
      "href",
      "/de/admin/design?x=1&tab=a&tab=b",
    );
    expect(screen.getByRole("link", { name: de.common.english })).toHaveAttribute(
      "href",
      "/en/admin/design?x=1&tab=a&tab=b",
    );
  });

  it("links the bare path when there is no query string", () => {
    boundary.search = "";
    renderSwitcher();
    expect(screen.getByRole("link", { name: de.common.english })).toHaveAttribute(
      "href",
      "/en/admin/design",
    );
  });

  it("marks the current language and tags every option with its own language and hreflang", () => {
    renderSwitcher("en-CH");
    const german = screen.getByRole("link", { name: en.common.german });
    const english = screen.getByRole("link", { name: en.common.english });
    expect(english).toHaveAttribute("aria-current", "true");
    expect(german).not.toHaveAttribute("aria-current");
    expect(german).toHaveAttribute("lang", "de-CH");
    expect(german).toHaveAttribute("hreflang", "de-CH");
    expect(english).toHaveAttribute("lang", "en-CH");
    expect(english).toHaveAttribute("hreflang", "en-CH");
  });

  it("stores the short code of the chosen language through setLocale on click, best effort", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole("link", { name: de.common.english }));
    expect(boundary.setLocale).toHaveBeenCalledWith({ locale: "en" });
  });

  it("keeps working when the action fails: the link itself carries the switch", async () => {
    boundary.setLocale.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole("link", { name: de.common.english }));
    expect(screen.getByRole("link", { name: de.common.english })).toHaveAttribute(
      "href",
      "/en/admin/design?x=1&tab=a&tab=b",
    );
  });

  it("is reachable by keyboard in reading order", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.tab();
    expect(screen.getByRole("link", { name: de.common.german })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: de.common.english })).toHaveFocus();
  });
});

describe("LocaleMenuItems, the sidebar submenu (spec 0004, AC-2)", () => {
  async function openSubmenu(user: ReturnType<typeof userEvent.setup>, locale: "de-CH" | "en-CH") {
    await user.click(screen.getByRole("button", { name: "Konto" }));
    const trigger = await screen.findByRole("menuitem", {
      name: new RegExp(MESSAGES[locale].common.language),
    });
    trigger.focus();
    await user.keyboard("{ArrowRight}");
    return trigger;
  }

  it("shows the current language on the trigger and preselects it in the radio group", async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = await openSubmenu(user, "de-CH");
    expect(trigger).toHaveTextContent(de.common.german);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const options = await screen.findAllByRole("menuitemradio");
    expect(options.map((option) => option.textContent)).toEqual([
      de.common.german,
      de.common.english,
    ]);
    expect(screen.getByRole("menuitemradio", { name: de.common.german })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: de.common.english })).toHaveAttribute(
      "lang",
      "en-CH",
    );
  });

  it("stores the choice first and then replaces the page with the same path and query in the other language", async () => {
    const user = userEvent.setup();
    renderMenu();
    await openSubmenu(user, "de-CH");
    await user.click(await screen.findByRole("menuitemradio", { name: de.common.english }));
    await waitFor(() => expect(boundary.replace).toHaveBeenCalledTimes(1));
    expect(boundary.setLocale).toHaveBeenCalledWith({ locale: "en" });
    expect(boundary.setLocale.mock.invocationCallOrder[0]).toBeLessThan(
      boundary.replace.mock.invocationCallOrder[0] ?? 0,
    );
    expect(landedOn(boundary.replace.mock.calls[0]?.[0])).toBe("/en/admin/design?x=1&tab=a&tab=b");
  });

  it("switches back to German from an English page", async () => {
    boundary.pathname = "/en/app";
    boundary.search = "";
    const user = userEvent.setup();
    renderMenu("en-CH");
    await openSubmenu(user, "en-CH");
    await user.click(await screen.findByRole("menuitemradio", { name: en.common.german }));
    await waitFor(() => expect(boundary.replace).toHaveBeenCalledTimes(1));
    expect(boundary.setLocale).toHaveBeenCalledWith({ locale: "de" });
    expect(landedOn(boundary.replace.mock.calls[0]?.[0])).toBe("/de/app");
  });
});
