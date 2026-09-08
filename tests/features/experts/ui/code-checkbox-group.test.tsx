import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { REGION_CODES, STANDARD_CODES } from "@/features/experts/catalogue";
import { CodeCheckboxGroup } from "@/features/experts/ui/code-checkbox-group";
import { renderWithIntl } from "../../emails/ui/helpers";

/**
 * The multi select over one catalogue list (spec 0013, AC-4, AC-5). Two things matter beyond the
 * ticking: the saved order always matches the catalogue order however the boxes were clicked, so
 * two experts who chose the same standards store the same array; and the group is a real fieldset
 * whose error reaches a screen reader once, not once per checkbox.
 */

const codes = ["iso_45001", "iso_14001", "iso_9001"] as const;
const labelFor = (code: string) => `Standard ${code}`;

function renderGroup(overrides: Partial<Parameters<typeof CodeCheckboxGroup>[0]> = {}) {
  const onValueChange = vi.fn();
  const view = renderWithIntl(
    <CodeCheckboxGroup
      codes={codes}
      value={[]}
      onValueChange={onValueChange}
      labelFor={labelFor}
      legend="Standards"
      idPrefix="standards"
      {...overrides}
    />,
  );
  return { ...view, onValueChange };
}

/** The same group, but holding its own state, so a sequence of clicks can be driven. */
function StatefulGroup({ initial = [] as readonly string[] }) {
  const [value, setValue] = useState<readonly string[]>(initial);
  return (
    <>
      <CodeCheckboxGroup
        codes={codes}
        value={value}
        onValueChange={setValue}
        labelFor={labelFor}
        legend="Standards"
        idPrefix="standards"
      />
      <output data-testid="value">{value.join(",")}</output>
    </>
  );
}

describe("the group's shape", () => {
  it("offers one checkbox per code, labelled in the reader's language", () => {
    renderGroup();
    for (const code of codes) {
      expect(screen.getByRole("checkbox", { name: labelFor(code) })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("checkbox")).toHaveLength(codes.length);
  });

  it("groups them under a legend, so the list is announced as one question", () => {
    renderGroup();
    expect(screen.getByRole("group", { name: "Standards" })).toBeInTheDocument();
  });

  it("ticks exactly the codes it was given", () => {
    renderGroup({ value: ["iso_45001", "iso_9001"] });
    expect(screen.getByRole("checkbox", { name: labelFor("iso_45001") })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: labelFor("iso_14001") })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: labelFor("iso_9001") })).toBeChecked();
  });

  it("gives every checkbox a prefixed id, so two groups on one page never collide", () => {
    const { unmount } = renderGroup({ idPrefix: "profile-standards" });
    expect(screen.getByRole("checkbox", { name: labelFor("iso_45001") })).toHaveAttribute(
      "id",
      "profile-standards-iso_45001",
    );
    unmount();
    renderGroup({ idPrefix: "ops-standards" });
    expect(screen.getByRole("checkbox", { name: labelFor("iso_45001") })).toHaveAttribute(
      "id",
      "ops-standards-iso_45001",
    );
  });

  it("disables every box together", () => {
    renderGroup({ disabled: true });
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
  });
});

describe("choosing codes", () => {
  it("adds a code when a box is ticked", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderGroup();
    await user.click(screen.getByRole("checkbox", { name: labelFor("iso_14001") }));
    expect(onValueChange).toHaveBeenCalledWith(["iso_14001"]);
  });

  it("removes a code when a box is unticked", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderGroup({ value: ["iso_45001", "iso_9001"] });
    await user.click(screen.getByRole("checkbox", { name: labelFor("iso_45001") }));
    expect(onValueChange).toHaveBeenCalledWith(["iso_9001"]);
  });

  it("saves in catalogue order however the boxes were clicked", async () => {
    // Two experts who cover the same standards must store the same array, or a later diff or
    // match reads two identical profiles as different.
    const user = userEvent.setup();
    renderWithIntl(<StatefulGroup />);
    await user.click(screen.getByRole("checkbox", { name: labelFor("iso_9001") }));
    await user.click(screen.getByRole("checkbox", { name: labelFor("iso_45001") }));
    await user.click(screen.getByRole("checkbox", { name: labelFor("iso_14001") }));
    expect(screen.getByTestId("value")).toHaveTextContent("iso_45001,iso_14001,iso_9001");
  });

  it("re orders a value that arrived out of catalogue order on the next tick", async () => {
    const user = userEvent.setup();
    renderWithIntl(<StatefulGroup initial={["iso_9001", "iso_45001"]} />);
    await user.click(screen.getByRole("checkbox", { name: labelFor("iso_14001") }));
    expect(screen.getByTestId("value")).toHaveTextContent("iso_45001,iso_14001,iso_9001");
  });

  it("leaves the value alone when nothing is clicked", () => {
    const { onValueChange } = renderGroup({ value: ["iso_45001"] });
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe("the error", () => {
  it("binds one message to the whole group rather than to each box", async () => {
    renderGroup({ error: "Choose at least one standard.", description: "Pick what you cover." });
    const group = screen.getByRole("group", { name: "Standards" });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveAccessibleDescription("Pick what you cover. Choose at least one standard.");
  });

  it("describes the group with the description alone when there is no error", () => {
    renderGroup({ description: "Pick what you cover." });
    const group = screen.getByRole("group", { name: "Standards" });
    expect(group).toHaveAccessibleDescription("Pick what you cover.");
    expect(group).not.toHaveAttribute("aria-invalid");
  });
});

describe("the real catalogue lists", () => {
  it("renders every canton, the longest list the form shows", () => {
    renderGroup({ codes: REGION_CODES, columns: 4, idPrefix: "regions" });
    expect(screen.getAllByRole("checkbox")).toHaveLength(REGION_CODES.length);
  });

  it("renders every standard", () => {
    renderGroup({ codes: STANDARD_CODES, idPrefix: "standards" });
    expect(screen.getAllByRole("checkbox")).toHaveLength(STANDARD_CODES.length);
  });
});
