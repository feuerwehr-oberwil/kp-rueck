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

  it("draws destructive as a red outline, never a red fill", () => {
    render(<Button variant="destructive">Löschen</Button>);
    const button = screen.getByRole("button", { name: "Löschen" });
    expect(button).toHaveClass("text-destructive", "border-destructive/60", "bg-transparent");
    expect(button.className).not.toMatch(/(^|\s)bg-destructive(\s|$)/);
  });

  it("fills the main action with ink, not the red primary", () => {
    render(<Button>Neuer Einsatz</Button>);
    const button = screen.getByRole("button", { name: "Neuer Einsatz" });
    expect(button).toHaveClass("bg-action", "text-action-foreground");
    expect(button.className).not.toMatch(/bg-primary/);
  });

  it("draws a chosen option tonal in the slate selection role", () => {
    render(
      <Button variant="selected" aria-pressed>
        Aktiv
      </Button>,
    );
    const chosen = screen.getByRole("button", { name: "Aktiv" });
    expect(chosen).toHaveClass("bg-sel-wash", "text-sel-foreground", "border-sel-edge");
    expect(chosen.className).not.toMatch(/bg-primary/);
  });
});
