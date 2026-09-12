import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import de from "../../messages/de-CH.json";
import en from "../../messages/en-CH.json";

/**
 * The account block and the sidebar header per area: a client sees their own company, staff keep
 * the role label that tells the two staff areas apart. The App Router and the sign out action are
 * the boundaries, so both are spies; the sidebar itself reads only the props the shell hands it.
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/en/app",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({ locale: "en-CH" }),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

vi.mock("@/features/auth/actions", () => ({ signOut: vi.fn() }));

vi.mock("@/features/localization/actions", () => ({
  setLocale: vi.fn().mockResolvedValue({ ok: true, data: { persisted: true } }),
}));

const MESSAGES = { "de-CH": de, "en-CH": en } as const;

// `role` here is the app role from `app_metadata.role`, not an ARIA role. Biome's
// `useValidAriaRole` reads a string literal on a component as the DOM attribute, so the three
// values travel as constants; the real shell passes a variable for the same reason.
const APP_ROLE = { client: "client", expert: "expert", ops: "ops" } as const;

type Props = Partial<Parameters<typeof AppSidebar>[0]>;

function renderSidebar(props: Props = {}, locale: "de-CH" | "en-CH" = "en-CH") {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {/* Both providers the real shell wraps the sidebar in (`AreaShell`). */}
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar
            area="app"
            email="client@example.com"
            role={APP_ROLE.client}
            locale={locale}
            organizationName="Musterfirma AG"
            fullName={null}
            {...props}
          />
        </SidebarProvider>
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}

/** The account button, found by the accessible name the trigger must keep (WCAG 2.2 AA). */
function accountButton(locale: "de-CH" | "en-CH" = "en-CH") {
  return screen.getByRole("button", { name: MESSAGES[locale].shell.userMenu });
}

describe("AppSidebar, the client area", () => {
  it("names the company under the wordmark and in the account block, with no role label anywhere", () => {
    renderSidebar();
    // Twice: the header's second line and the account block's primary line.
    expect(screen.getAllByText("Musterfirma AG")).toHaveLength(2);
    expect(screen.getByText("SME24")).toBeInTheDocument();
    expect(screen.getByText("client@example.com")).toBeInTheDocument();
    expect(screen.queryByText(en.shell.role.client)).not.toBeInTheDocument();
  });

  it("keeps the account button's accessible name while the company is the visible primary line", () => {
    renderSidebar();
    const button = accountButton();
    expect(button).toHaveAccessibleName(en.shell.userMenu);
    expect(button).toHaveTextContent("Musterfirma AG");
    expect(button).toHaveTextContent("client@example.com");
  });

  it("falls back to a label of its own when the client has no organization yet", () => {
    renderSidebar({ organizationName: null });
    expect(screen.getAllByText(en.shell.noOrganization)).toHaveLength(2);
    expect(screen.queryByText(en.areas.app.title)).not.toBeInTheDocument();
    expect(screen.queryByText(en.shell.role.client)).not.toBeInTheDocument();
  });

  it("treats a blank organization name as none, rather than printing an empty line", () => {
    renderSidebar({ organizationName: "   " });
    expect(screen.getAllByText(en.shell.noOrganization)).toHaveLength(2);
  });

  it("shows the German fallback in the German catalog", () => {
    renderSidebar({ organizationName: null }, "de-CH");
    expect(screen.getAllByText(de.shell.noOrganization)).toHaveLength(2);
    expect(screen.queryByText(de.shell.role.client)).not.toBeInTheDocument();
  });

  it("shows the full name in the dropdown header when set, with the whole address beneath it", async () => {
    const user = userEvent.setup();
    renderSidebar({ fullName: "Anna Muster" });
    await user.click(accountButton());
    const menu = await screen.findByRole("menu");
    expect(menu).toHaveTextContent("Anna Muster");
    // The address is in the dropdown in full, which the truncated trigger cannot promise.
    expect(menu).toHaveTextContent("client@example.com");
    expect(menu).not.toHaveTextContent(en.shell.role.client);
  });

  it("falls back to the address as the dropdown header when no full name is set", async () => {
    const user = userEvent.setup();
    renderSidebar({ fullName: null });
    await user.click(accountButton());
    const menu = await screen.findByRole("menu");
    expect(menu).toHaveTextContent("client@example.com");
  });
});

describe("AppSidebar, the staff areas", () => {
  it("keeps the expert area title and the expert role label, the address staying the primary line", () => {
    renderSidebar({
      area: "expert",
      email: "expert@example.com",
      role: APP_ROLE.expert,
      organizationName: null,
    });
    expect(screen.getByText(en.areas.expert.title)).toBeInTheDocument();
    expect(screen.getByText(en.shell.role.expert)).toBeInTheDocument();
    expect(screen.getByText("expert@example.com")).toBeInTheDocument();
    expect(screen.queryByText(en.shell.noOrganization)).not.toBeInTheDocument();
  });

  it("keeps the ops area title and the ops role label", () => {
    renderSidebar({
      area: "admin",
      email: "ops@example.com",
      role: APP_ROLE.ops,
      organizationName: null,
    });
    expect(screen.getByText(en.areas.admin.title)).toBeInTheDocument();
    expect(screen.getByText(en.shell.role.ops)).toBeInTheDocument();
    expect(screen.queryByText(en.shell.noOrganization)).not.toBeInTheDocument();
  });

  it("still shows the role label in the staff dropdown header", async () => {
    const user = userEvent.setup();
    renderSidebar({ area: "expert", email: "expert@example.com", role: "expert" });
    await user.click(accountButton());
    const menu = await screen.findByRole("menu");
    expect(menu).toHaveTextContent(en.shell.role.expert);
    expect(menu).toHaveTextContent("expert@example.com");
  });

  it("ignores an organization name in a staff area, which the shell never loads for them", () => {
    renderSidebar({ area: "admin", role: APP_ROLE.ops, organizationName: "Musterfirma AG" });
    expect(screen.getByText(en.areas.admin.title)).toBeInTheDocument();
    expect(screen.queryByText("Musterfirma AG")).not.toBeInTheDocument();
  });
});
