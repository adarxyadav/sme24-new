import { render, screen } from "@testing-library/react";
import { InboxIcon } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import de from "../messages/de.json";

// The App Router is not mounted in jsdom; next-intl's Link only needs these hooks to exist.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

function renderDe(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="de" messages={de}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PageHeader (spec 0003, AC-5)", () => {
  it("renders the one h1, the description, the breadcrumb and the actions", () => {
    renderDe(
      <PageHeader
        title="Unternehmen"
        description="Alle Kundenunternehmen."
        breadcrumb={[{ label: "Ops Admin", href: "/admin" }, { label: "Unternehmen" }]}
        actions={<Button>Neu</Button>}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Unternehmen");
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByText("Alle Kundenunternehmen.")).toBeInTheDocument();
    const breadcrumb = screen.getByRole("navigation", { name: de.ui.breadcrumb });
    expect(breadcrumb).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ops Admin" })).toHaveAttribute("href", "/de/admin");
    expect(
      screen.getByText("Unternehmen", { selector: "[aria-current=page]" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Neu" })).toBeInTheDocument();
  });

  it("renders no breadcrumb landmark and no description when they are omitted", () => {
    renderDe(<PageHeader title="Übersicht" />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Übersicht");
  });
});

describe("EmptyState (spec 0003, AC-7)", () => {
  it("shows icon, title, description and the single action, with the icon hidden from AT", () => {
    renderDe(
      <EmptyState
        icon={InboxIcon}
        title="Noch keine Läufe"
        description="Starten Sie einen Job."
        action={<Button>Starten</Button>}
      />,
    );
    expect(screen.getByText("Noch keine Läufe")).toBeInTheDocument();
    expect(screen.getByText("Starten Sie einen Job.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Starten" })).toBeInTheDocument();
    expect(document.querySelector("svg")?.closest("[aria-hidden=true]")).not.toBeNull();
  });

  it("renders the title as a paragraph by default and as the page heading on request", () => {
    const { unmount } = renderDe(
      <EmptyState icon={InboxIcon} title="Leer" description="Nichts." />,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    unmount();

    renderDe(
      <EmptyState icon={InboxIcon} title="Kein Zugriff" description="Nichts." titleAs="h1" />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Kein Zugriff");
  });
});

describe("ErrorState (spec 0003, AC-7)", () => {
  it("is an alert with retry and the reference id, and retry calls back", () => {
    const onRetry = vi.fn();
    renderDe(
      <ErrorState
        title={de.states.error.title}
        description={de.states.error.description}
        onRetry={onRetry}
        eventId="abc123"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(de.states.error.title);
    expect(alert).toHaveTextContent("Referenz: abc123");
    screen.getByRole("button", { name: de.states.error.retry }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("omits retry and reference when they are not provided", () => {
    renderDe(<ErrorState title="Fehler" description="Beschreibung" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Referenz/)).toBeNull();
  });
});
