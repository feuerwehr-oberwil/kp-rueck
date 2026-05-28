import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders its children", () => {
    render(<Button>Alarmierung</Button>);
    expect(
      screen.getByRole("button", { name: "Alarmierung" }),
    ).toBeInTheDocument();
  });

  it("fires onClick when activated", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Bestätigen</Button>);

    await user.click(screen.getByRole("button", { name: "Bestätigen" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Abbrechen
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies the destructive variant class", () => {
    render(<Button variant="destructive">Löschen</Button>);
    expect(screen.getByRole("button", { name: "Löschen" })).toHaveClass(
      "bg-destructive",
    );
  });
});
