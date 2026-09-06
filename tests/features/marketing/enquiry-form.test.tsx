import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnquiryActionResult } from "@/features/marketing/actions";
import { EnquiryForm } from "@/features/marketing/ui/enquiry-form";
import { EnquiryFormFromQuery } from "@/features/marketing/ui/enquiry-form-from-query";
import { formats, TIME_ZONE } from "@/i18n/formats";
import de from "../../../messages/de-CH.json";
import en from "../../../messages/en-CH.json";

/**
 * The enquiry form of the contact page (spec 0009, AC-8, AC-9, AC-10): the topic from the query
 * is preselected, every field is labelled, the character count follows the message, an invalid
 * submit shows the errors under the fields and in an announced summary with links, a valid
 * submit hands the action the parsed values plus the honeypot and the mount time, a server
 * validation result lands on the fields, a guard result is announced, and a success replaces the
 * form with the confirmation. The server action and the App Router hooks are the boundaries.
 */
const boundary = vi.hoisted(() => ({
  submitEnquiry:
    vi.fn<(previous: EnquiryActionResult | null, input: unknown) => Promise<EnquiryActionResult>>(),
  search: "",
}));

// jsdom has no ResizeObserver; Radix's radio group measures its hidden input with one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
vi.mock("@/features/marketing/actions", () => ({ submitEnquiry: boundary.submitEnquiry }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/en/contact",
  useSearchParams: () => new URLSearchParams(boundary.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ locale: "en-CH" }),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

type TestLocale = "de-CH" | "en-CH";
const MESSAGES = { "de-CH": de, "en-CH": en } as const;

function renderIn(ui: ReactNode, locale: TestLocale = "en-CH") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      formats={formats}
      timeZone={TIME_ZONE}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

const form = en.marketing.contact.form;
const ENQUIRY_ID = "e0000000-0000-4000-8000-000000000001";
const MESSAGE = "We run three sites in Aargau and need a partner for the audits.";

function field(name: string) {
  return screen.getByRole("textbox", { name });
}

/** The announced summary: every field error is an alert too, so the summary is the one with the title. */
async function findSummary() {
  const alerts = await screen.findAllByRole("alert");
  const summary = alerts.find((alert) => alert.textContent?.includes(form.summaryTitle));
  if (!summary) throw new Error("the error summary was not rendered");
  return summary;
}

/** Fills the four required fields with valid values. */
async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(field(form.fields.companyName), "Muster AG");
  await user.type(field(form.fields.contactName), "Clara Muster");
  await user.type(field(form.fields.email), "Clara@Example.test");
  await user.type(field(form.fields.message), MESSAGE);
}

beforeEach(() => {
  boundary.search = "";
  boundary.submitEnquiry.mockResolvedValue({ ok: true, data: { id: ENQUIRY_ID } });
});

describe("EnquiryForm (AC-8)", () => {
  it("preselects the given topic, labels every field and hides the honeypot from readers and the tab order", () => {
    const { container } = renderIn(<EnquiryForm defaultTopic="retainer" />);
    expect(screen.getByRole("radio", { name: form.topics.retainer })).toBeChecked();
    expect(screen.getByRole("radio", { name: form.topics.general })).not.toBeChecked();
    for (const label of [
      form.fields.companyName,
      form.fields.contactName,
      form.fields.email,
      form.fields.phone,
      form.fields.message,
    ]) {
      expect(field(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("combobox", { name: form.fields.headcountBand })).toHaveTextContent(
      form.headcountPlaceholder,
    );
    expect(field(form.fields.message)).toHaveAccessibleDescription(form.messageHint);
    expect(screen.getByRole("button", { name: form.submit })).toBeEnabled();

    const honeypot = container.querySelector<HTMLInputElement>("#enquiry-website");
    expect(honeypot).not.toBeNull();
    expect(honeypot).toHaveAttribute("name", "website");
    expect(honeypot).toHaveAttribute("tabindex", "-1");
    expect(honeypot?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: form.honeypot })).toBeNull();
  });

  it("counts the message characters live", async () => {
    const user = userEvent.setup();
    renderIn(<EnquiryForm defaultTopic="general" />);
    expect(screen.getByText("0 of 2000 characters")).toBeInTheDocument();
    await user.type(field(form.fields.message), "Hello");
    expect(screen.getByText("5 of 2000 characters")).toBeInTheDocument();
  });

  it("renders the German labels and the German topic hint", () => {
    renderIn(<EnquiryForm defaultTopic="retainer" />, "de-CH");
    const german = de.marketing.contact.form;
    expect(screen.getByRole("radio", { name: german.topics.retainer })).toBeChecked();
    expect(screen.getByText(german.topicHints.retainer)).toBeInTheDocument();
    expect(field(german.fields.message)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: german.submit })).toBeInTheDocument();
  });

  it("shows the errors under the fields and in a summary with links on an empty submit, without calling the action", async () => {
    const user = userEvent.setup();
    renderIn(<EnquiryForm defaultTopic="general" />);
    await user.click(screen.getByRole("button", { name: form.submit }));

    const summary = await findSummary();
    const links = Array.from(summary.querySelectorAll("a")).map((link) => [
      link.textContent,
      link.getAttribute("href"),
    ]);
    expect(links).toEqual([
      [form.fields.companyName, "#enquiry-companyName"],
      [form.fields.contactName, "#enquiry-contactName"],
      [form.fields.email, "#enquiry-email"],
      [form.fields.message, "#enquiry-message"],
    ]);

    const company = field(form.fields.companyName);
    expect(company).toHaveAttribute("aria-invalid", "true");
    expect(company).toHaveAccessibleDescription(form.errors.companyRequired);
    expect(field(form.fields.contactName)).toHaveAccessibleDescription(form.errors.nameRequired);
    expect(field(form.fields.email)).toHaveAttribute("aria-invalid", "true");
    const message = field(form.fields.message);
    expect(message).toHaveAttribute("aria-invalid", "true");
    expect(message).toHaveAccessibleDescription(new RegExp(form.errors.messageShort));
    expect(field(form.fields.phone)).not.toHaveAttribute("aria-invalid");
    expect(boundary.submitEnquiry).not.toHaveBeenCalled();
  });

  it("hands the action the parsed values, the empty honeypot and the mount time, then shows the confirmation (AC-9)", async () => {
    const user = userEvent.setup();
    const before = Date.now();
    renderIn(<EnquiryForm defaultTopic="retainer" />);
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: form.submit }));

    await waitFor(() => expect(boundary.submitEnquiry).toHaveBeenCalledTimes(1));
    const input = boundary.submitEnquiry.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(input).toMatchObject({
      topic: "retainer",
      companyName: "Muster AG",
      contactName: "Clara Muster",
      email: "clara@example.test",
      phone: null,
      headcountBand: null,
      message: MESSAGE,
      locale: "en",
      website: "",
    });
    expect(input.startedAt).toMatch(/^\d+$/);
    expect(Number(input.startedAt)).toBeGreaterThanOrEqual(before);
    expect(Number(input.startedAt)).toBeLessThanOrEqual(Date.now());

    const confirmation = await screen.findByRole("status");
    expect(confirmation).toHaveTextContent(en.marketing.contact.success.title);
    expect(confirmation).toHaveTextContent(en.marketing.contact.success.body);
    expect(screen.getByRole("link", { name: en.marketing.contact.success.back })).toHaveAttribute(
      "href",
      "/en",
    );
    expect(screen.queryByRole("button", { name: form.submit })).toBeNull();
  });

  it("sends a filled honeypot to the action so the server can drop the bot (AC-10)", async () => {
    const user = userEvent.setup();
    const { container } = renderIn(<EnquiryForm defaultTopic="general" />);
    await fillValid(user);
    const honeypot = container.querySelector<HTMLInputElement>("#enquiry-website");
    if (!honeypot) throw new Error("the honeypot is missing");
    honeypot.value = "https://bot.example";
    await user.click(screen.getByRole("button", { name: form.submit }));
    await waitFor(() => expect(boundary.submitEnquiry).toHaveBeenCalledTimes(1));
    expect(boundary.submitEnquiry.mock.calls[0]?.[1]).toMatchObject({
      website: "https://bot.example",
    });
  });

  it("puts a server validation result on its field and in the summary", async () => {
    const user = userEvent.setup();
    boundary.submitEnquiry.mockResolvedValue({
      ok: false,
      error: "validation",
      fields: { email: "Bad address" },
    });
    renderIn(<EnquiryForm defaultTopic="general" />);
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: form.submit }));

    const summary = await findSummary();
    expect(summary.querySelector("a")).toHaveAttribute("href", "#enquiry-email");
    const email = field(form.fields.email);
    await waitFor(() => expect(email).toHaveAttribute("aria-invalid", "true"));
    expect(email).toHaveAccessibleDescription("Bad address");
    expect(field(form.fields.companyName)).not.toHaveAttribute("aria-invalid");
  });

  it("announces the rate limit with the contact address and keeps the form (AC-10)", async () => {
    const user = userEvent.setup();
    boundary.submitEnquiry.mockResolvedValue({ ok: false, error: "rate_limited" });
    renderIn(<EnquiryForm defaultTopic="general" />);
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: form.submit }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Please try again later or write to service@sme24.ch.");
    expect(screen.getByRole("button", { name: form.submit })).toBeEnabled();
    expect(field(form.fields.companyName)).toHaveValue("Muster AG");
  });

  it("announces an unavailable database with the contact address", async () => {
    const user = userEvent.setup();
    boundary.submitEnquiry.mockResolvedValue({ ok: false, error: "unavailable" });
    renderIn(<EnquiryForm defaultTopic="general" />);
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: form.submit }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The enquiry could not be saved. Please try again in a moment or write to service@sme24.ch.",
    );
  });

  // The summary of this state is not asserted: react-hook-form reads its errors through a proxy
  // that the browser refreshes before the trigger promise settles, while Testing Library's act
  // holds that render back, so here the summary list stays empty. The gallery shows it by hand.
  it("shows every field error right after mount without moving focus when asked (the gallery state)", async () => {
    renderIn(<EnquiryForm defaultTopic="general" validateOnMount />);
    const company = field(form.fields.companyName);
    await waitFor(() => expect(company).toHaveAttribute("aria-invalid", "true"));
    expect(company).toHaveAccessibleDescription(form.errors.companyRequired);
    expect(field(form.fields.contactName)).toHaveAttribute("aria-invalid", "true");
    expect(field(form.fields.email)).toHaveAttribute("aria-invalid", "true");
    expect(field(form.fields.message)).toHaveAttribute("aria-invalid", "true");
    expect(field(form.fields.phone)).not.toHaveAttribute("aria-invalid");
    expect(document.activeElement).toBe(document.body);
    expect(boundary.submitEnquiry).not.toHaveBeenCalled();
  });

  it("links the privacy note when the page exists and renders plain text until then", () => {
    const { rerender } = renderIn(<EnquiryForm defaultTopic="general" />);
    expect(screen.queryByRole("link", { name: "Privacy policy" })).toBeNull();
    expect(screen.getByText("Privacy policy")).toBeInTheDocument();
    rerender(
      <NextIntlClientProvider locale="en-CH" messages={en} formats={formats} timeZone={TIME_ZONE}>
        <EnquiryForm defaultTopic="general" privacyHref="/en/privacy" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
      "href",
      "/en/privacy",
    );
  });
});

describe("EnquiryFormFromQuery (AC-8)", () => {
  it("preselects the retainer from the pricing page's link", () => {
    boundary.search = "topic=retainer";
    renderIn(<EnquiryFormFromQuery />);
    expect(screen.getByRole("radio", { name: form.topics.retainer })).toBeChecked();
  });

  it("falls back to the general question without a topic or with an unknown one", () => {
    const first = renderIn(<EnquiryFormFromQuery />);
    expect(screen.getByRole("radio", { name: form.topics.general })).toBeChecked();
    first.unmount();
    boundary.search = "topic=bogus";
    renderIn(<EnquiryFormFromQuery />);
    expect(screen.getByRole("radio", { name: form.topics.general })).toBeChecked();
    expect(screen.getByRole("radio", { name: form.topics.retainer })).not.toBeChecked();
  });
});
