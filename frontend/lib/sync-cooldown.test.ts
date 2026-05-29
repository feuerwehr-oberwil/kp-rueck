import { describe, expect, it } from "vitest";
import {
  decideCooldownClearAction,
  decidePollTickAction,
  decideRemoteUpdateAction,
} from "./sync-cooldown";

describe("decideRemoteUpdateAction", () => {
  it("fetches immediately when no cooldown is active", () => {
    expect(decideRemoteUpdateAction({ inCooldown: false })).toBe("fetch");
  });
  it("queues for replay when a cooldown is active", () => {
    expect(decideRemoteUpdateAction({ inCooldown: true })).toBe("queue");
  });
});

describe("decidePollTickAction", () => {
  it("skips while a load is already in flight", () => {
    expect(decidePollTickAction({ isLoading: true, inCooldown: false })).toBe(
      "skip",
    );
  });
  it("queues during a cooldown (keeps the cadence)", () => {
    expect(decidePollTickAction({ isLoading: false, inCooldown: true })).toBe(
      "queue",
    );
  });
  it("fetches when free", () => {
    expect(decidePollTickAction({ isLoading: false, inCooldown: false })).toBe(
      "fetch",
    );
  });
  it("loading wins over cooldown", () => {
    expect(decidePollTickAction({ isLoading: true, inCooldown: true })).toBe(
      "skip",
    );
  });
});

describe("decideCooldownClearAction", () => {
  it("skips when no replay is pending", () => {
    expect(
      decideCooldownClearAction({
        pendingReplay: false,
        stillInCooldown: false,
      }),
    ).toBe("skip");
  });
  it("skips when another cooldown is still extending the window", () => {
    expect(
      decideCooldownClearAction({
        pendingReplay: true,
        stillInCooldown: true,
      }),
    ).toBe("skip");
  });
  it("fetches when the cooldown actually cleared and a replay is queued", () => {
    expect(
      decideCooldownClearAction({
        pendingReplay: true,
        stillInCooldown: false,
      }),
    ).toBe("fetch");
  });
});
