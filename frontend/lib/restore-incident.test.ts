import { describe, expect, it } from "vitest";
import { decideRestoreAction } from "./restore-incident";

describe("decideRestoreAction", () => {
  it("refreshes and shows the success toast when the restore succeeds", () => {
    expect(decideRestoreAction("ok")).toBe("refresh-success");
  });

  it("refreshes silently on 409 (already restored elsewhere)", () => {
    // A double-click on the undo toast, or another client restoring first,
    // 409s — treat it as success and reconcile the board without a toast.
    expect(decideRestoreAction("conflict")).toBe("refresh-silent");
  });

  it("shows an error toast on a network failure (undefined response)", () => {
    expect(decideRestoreAction("network")).toBe("error");
  });

  it("shows an error toast on any other failure", () => {
    expect(decideRestoreAction("error")).toBe("error");
  });
});
