import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PHOTO_MAX_BYTES, PHOTO_TYPES } from "@/features/experts/catalogue";
import { ExpertPhotoField } from "@/features/experts/ui/photo-field";
import { en, renderWithIntl } from "../../emails/ui/helpers";

/**
 * The expert photo control (spec 0013, AC-6), and the regression `/debug expert photo upload
 * limit` owed on 2026-09-08.
 *
 * The bug it guards: `PHOTO_MAX_BYTES` is 2 MB, but Next rejects a server action body over its own
 * limit before the action ever runs, so an oversized file produced no answer at all — no toast, no
 * alert, nothing. `next.config.ts` now raises `serverActions.bodySizeLimit` to 3 MB so the
 * action's `too_large` can fire, and this component checks the size first so a file past the cap
 * never leaves the browser. The two assertions that matter are therefore: over the cap renders the
 * `too_large` alert and calls no action, under the cap does call it.
 */
const boundary = vi.hoisted(() => ({
  upload: vi.fn<(body: FormData) => Promise<{ ok: true } | { ok: false; error: string }>>(),
  remove: vi.fn<(previous: unknown, input: unknown) => Promise<{ ok: true }>>(),
  refresh: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/features/experts/actions", () => ({
  uploadExpertPhoto: boundary.upload,
  removeExpertPhoto: boundary.remove,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: boundary.refresh,
    prefetch: vi.fn(),
  }),
  useParams: () => ({ locale: "en-CH" }),
  usePathname: () => "/en/expert/profile",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: boundary.success, error: vi.fn() } }));

const strings = en.experts.photo;

/** A `File` of an exact byte length; the bytes themselves are never read, only `size` and `type`. */
function photoOf(bytes: number, type = "image/png", name = "photo.png"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function renderField(overrides: Partial<Parameters<typeof ExpertPhotoField>[0]> = {}) {
  return renderWithIntl(
    <ExpertPhotoField fullName="Rita Meier" photoUrl={null} hasPhoto={false} {...overrides} />,
    "en-CH",
  );
}

const picker = () => screen.getByLabelText(strings.label);

beforeEach(() => {
  boundary.upload.mockResolvedValue({ ok: true });
  boundary.remove.mockResolvedValue({ ok: true });
});

describe("the size guard (spec 0013, AC-6)", () => {
  it("refuses a file over the cap with the too_large alert and never calls the action", async () => {
    const user = userEvent.setup();
    renderField();

    await user.upload(picker(), photoOf(PHOTO_MAX_BYTES + 1));

    expect(await screen.findByText(strings.errors.too_large)).toBeInTheDocument();
    expect(boundary.upload).not.toHaveBeenCalled();
    expect(boundary.success).not.toHaveBeenCalled();
  });

  it("uploads a file under the cap", async () => {
    const user = userEvent.setup();
    renderField();

    await user.upload(picker(), photoOf(PHOTO_MAX_BYTES - 1));

    await waitFor(() => expect(boundary.upload).toHaveBeenCalledTimes(1));
    const body = boundary.upload.mock.calls[0]?.[0];
    expect(body).toBeInstanceOf(FormData);
    expect(body?.get("photo")).toBeInstanceOf(File);
    expect(screen.queryByText(strings.errors.too_large)).not.toBeInTheDocument();
  });

  it("uploads a file at exactly the cap, which the action's own check also accepts", async () => {
    // The boundary is `>`, not `>=`: 2 MB exactly is the largest file the spec promises to take,
    // and it is the size the raised body limit exists to let through.
    const user = userEvent.setup();
    renderField();

    await user.upload(picker(), photoOf(PHOTO_MAX_BYTES));

    await waitFor(() => expect(boundary.upload).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(strings.errors.too_large)).not.toBeInTheDocument();
  });

  it("keeps refusing after a refusal, so a second oversized pick is answered too", async () => {
    // The input's value is cleared on a refusal; without that the same file re picked fires no
    // change event and the expert would see a stale alert with no new answer.
    const user = userEvent.setup();
    renderField();

    await user.upload(picker(), photoOf(PHOTO_MAX_BYTES + 1));
    expect(await screen.findByText(strings.errors.too_large)).toBeInTheDocument();
    expect(picker()).toHaveValue("");

    await user.upload(picker(), photoOf(PHOTO_MAX_BYTES + 500_000));
    expect(screen.getByText(strings.errors.too_large)).toBeInTheDocument();
    expect(boundary.upload).not.toHaveBeenCalled();
  });
});

describe("the upload answer", () => {
  it("announces a saved photo and refreshes the page", async () => {
    const user = userEvent.setup();
    renderField();

    await user.upload(picker(), photoOf(1000));

    await waitFor(() => expect(boundary.success).toHaveBeenCalledWith(strings.uploaded));
    expect(boundary.refresh).toHaveBeenCalled();
  });

  it("shows the action's own error and does not announce a success", async () => {
    boundary.upload.mockResolvedValue({ ok: false, error: "unsupported_type" });
    const user = userEvent.setup();
    renderField();

    await user.upload(picker(), photoOf(1000, "image/png"));

    expect(await screen.findByText(strings.errors.unsupported_type)).toBeInTheDocument();
    expect(boundary.success).not.toHaveBeenCalled();
    expect(boundary.refresh).not.toHaveBeenCalled();
  });

  it("clears an earlier failure once an upload succeeds", async () => {
    boundary.upload.mockResolvedValueOnce({ ok: false, error: "unexpected" });
    const user = userEvent.setup();
    renderField();

    await user.upload(picker(), photoOf(1000));
    expect(await screen.findByText(strings.errors.unexpected)).toBeInTheDocument();

    await user.upload(picker(), photoOf(1000));
    await waitFor(() =>
      expect(screen.queryByText(strings.errors.unexpected)).not.toBeInTheDocument(),
    );
  });
});

describe("the control itself", () => {
  it("offers exactly the types the upload action accepts", () => {
    renderField();
    expect(picker()).toHaveAttribute("accept", Object.keys(PHOTO_TYPES).join(","));
  });

  it("describes the picker with the size hint", () => {
    renderField();
    expect(picker()).toHaveAccessibleDescription(strings.hint);
  });

  it("offers the remove button only once there is a photo", async () => {
    const { unmount } = renderField();
    expect(screen.queryByRole("button", { name: strings.remove })).not.toBeInTheDocument();
    unmount();

    renderField({ hasPhoto: true, photoUrl: "https://example.test/photo.png?token=abc" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: strings.remove }));

    await waitFor(() => expect(boundary.remove).toHaveBeenCalledWith(null, null));
    expect(boundary.success).toHaveBeenCalledWith(strings.removed);
  });

  it("falls back to the expert's initials when there is no photo", () => {
    renderField({ fullName: "Rita Meier" });
    expect(screen.getByText("RM")).toBeInTheDocument();
  });
});
