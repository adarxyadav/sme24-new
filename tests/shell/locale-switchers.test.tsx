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
  params: { locale: "de-CH" } as Record<string, string>,
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
  useParams: () => boundary.params,
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

vi.mock("@/features/localization/actions", () => ({
  setLocale: boundary.setLocale,
}));

const MESSAGES = { "de-CH": de, "en-CH": en } as const;
const DELIVERY_ID = "d0000000-0000-4000-8000-000000000001";

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
  boundary.params = { locale: "de-CH" };
  boundary.setLocale.mockResolvedValue({ ok: true, data: { persisted: true } });
});

describe("LocaleSwitcher, the marketing dropdown (spec 0004, AC-2)", () => {
  /** Opens the menu and answers its items; Radix renders them in a portal only once open. */
  async function openMenu(user: ReturnType<typeof userEvent.setup>, locale: "de-CH" | "en-CH") {
    const trigger = screen.getByRole("button", { name: MESSAGES[locale].common.language });
    await user.click(trigger);
    return trigger;
  }

  it("is a button labelled with the language label, showing the current language, that opens a menu of one link per locale", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    const trigger = screen.getByRole("button", { name: de.common.language });
    expect(trigger).toHaveTextContent(de.common.german);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([de.common.german, de.common.english]);
    for (const item of items) expect(item.tagName).toBe("A");
  });

  it("keeps the path and the whole query string, repeated keys included, in both links", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await openMenu(user, "de-CH");
    expect(await screen.findByRole("menuitem", { name: de.common.german })).toHaveAttribute(
      "href",
      "/de/admin/design?x=1&tab=a&tab=b",
    );
    expect(screen.getByRole("menuitem", { name: de.common.english })).toHaveAttribute(
      "href",
      "/en/admin/design?x=1&tab=a&tab=b",
    );
  });

  it("links the bare path when there is no query string", async () => {
    boundary.search = "";
    const user = userEvent.setup();
    renderSwitcher();
    await openMenu(user, "de-CH");
    expect(await screen.findByRole("menuitem", { name: de.common.english })).toHaveAttribute(
      "href",
      "/en/admin/design",
    );
  });

  it("keeps the id of a dynamic route such as a delivery detail page, the reason the params travel with the pathname", async () => {
    boundary.pathname = `/de/admin/emails/${DELIVERY_ID}`;
    boundary.search = "";
    boundary.params = { locale: "de-CH", id: DELIVERY_ID };
    const user = userEvent.setup();
    renderSwitcher();
    await openMenu(user, "de-CH");
    expect(await screen.findByRole("menuitem", { name: de.common.english })).toHaveAttribute(
      "href",
      `/en/admin/emails/${DELIVERY_ID}`,
    );
    expect(screen.getByRole("menuitem", { name: de.common.german })).toHaveAttribute(
      "href",
      `/de/admin/emails/${DELIVERY_ID}`,
    );
  });

  it("marks the current language and tags every option with its own language and hreflang", async () => {
    const user = userEvent.setup();
    renderSwitcher("en-CH");
    await openMenu(user, "en-CH");
    const german = await screen.findByRole("menuitem", { name: en.common.german });
    const english = screen.getByRole("menuitem", { name: en.common.english });
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
    await openMenu(user, "de-CH");
    await user.click(await screen.findByRole("menuitem", { name: de.common.english }));
    expect(boundary.setLocale).toHaveBeenCalledWith({ locale: "en" });
  });

  it("keeps working when the action fails: the link itself carries the switch and nothing is left unhandled", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    boundary.setLocale.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderSwitcher();
    await openMenu(user, "de-CH");
    const english = await screen.findByRole("menuitem", { name: de.common.english });
    expect(english).toHaveAttribute("href", "/en/admin/design?x=1&tab=a&tab=b");
    await user.click(english);
    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("opens from the keyboard and moves through the options with the arrow keys", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.tab();
    const trigger = screen.getByRole("button", { name: de.common.language });
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menuitem", { name: de.common.german })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: de.common.english })).toHaveFocus();
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

  it("still replaces the page when the write fails: the URL is the truth, the profile only feeds what leaves the app", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    boundary.setLocale.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderMenu();
    await openSubmenu(user, "de-CH");
    await user.click(await screen.findByRole("menuitemradio", { name: de.common.english }));
    await waitFor(() => expect(boundary.replace).toHaveBeenCalledTimes(1));
    expect(landedOn(boundary.replace.mock.calls[0]?.[0])).toBe("/en/admin/design?x=1&tab=a&tab=b");
    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("keeps the id of a dynamic route when replacing a delivery detail page in the other language", async () => {
    boundary.pathname = `/de/admin/emails/${DELIVERY_ID}`;
    boundary.search = "";
    boundary.params = { locale: "de-CH", id: DELIVERY_ID };
    const user = userEvent.setup();
    renderMenu();
    await openSubmenu(user, "de-CH");
    await user.click(await screen.findByRole("menuitemradio", { name: de.common.english }));
    await waitFor(() => expect(boundary.replace).toHaveBeenCalledTimes(1));
    expect(landedOn(boundary.replace.mock.calls[0]?.[0])).toBe(`/en/admin/emails/${DELIVERY_ID}`);
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
