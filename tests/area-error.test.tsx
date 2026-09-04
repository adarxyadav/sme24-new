import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AreaError } from "@/components/shell/area-error";
import de from "../messages/de.json";

// Sentry is the system boundary here: the id it hands back and whether a client is enabled.
const sentry = vi.hoisted(() => ({
  captureException: vi.fn<(error: unknown) => string>(),
  isEnabled: vi.fn<() => boolean>(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: sentry.captureException,
  isEnabled: sentry.isEnabled,
}));

type BoundaryError = Error & { digest?: string };

function failure(digest?: string): BoundaryError {
  const error: BoundaryError = new Error("loader failed");
  if (digest) error.digest = digest;
  return error;
}

function renderBoundary(error: BoundaryError, retry = vi.fn()) {
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <AreaError error={error} retry={retry} />
    </NextIntlClientProvider>,
  );
  return retry;
}

describe("AreaError (spec 0003, AC-7)", () => {
  beforeEach(() => {
    sentry.captureException.mockReturnValue("sentry-event-id");
    sentry.isEnabled.mockReturnValue(true);
  });

  it("captures the error once and shows the digest with the Sentry id when the client is enabled", () => {
    const error = failure("digest-123");
    renderBoundary(error);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(error);
    expect(screen.getByRole("alert")).toHaveTextContent("Referenz: digest-123 / sentry-event-id");
  });

  it("shows the digest only when Sentry is disabled, so a preview user quotes an id the log carries", () => {
    sentry.isEnabled.mockReturnValue(false);
    renderBoundary(failure("digest-123"));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Referenz: digest-123");
    expect(alert).not.toHaveTextContent("sentry-event-id");
  });

  it("shows the Sentry id alone when the error carries no digest", () => {
    renderBoundary(failure());
    expect(screen.getByRole("alert")).toHaveTextContent("Referenz: sentry-event-id");
  });

  it("shows no reference when there is no digest and no enabled client", () => {
    sentry.isEnabled.mockReturnValue(false);
    renderBoundary(failure());
    expect(screen.queryByText(/Referenz:/)).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(de.states.error.title);
  });

  it("wires the retry button to the boundary's retry", async () => {
    const user = userEvent.setup();
    const retry = renderBoundary(failure("digest-123"));
    await user.click(screen.getByRole("button", { name: de.states.error.retry }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
