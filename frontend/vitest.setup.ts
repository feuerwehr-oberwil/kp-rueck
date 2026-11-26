import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom doesn't ship with ResizeObserver, but several Radix primitives
// (Switch, Popover, Select) call it during layout effects. Stub it so
// component tests can mount those primitives without exploding.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub;
}

// hasPointerCapture is touched by Radix Select; jsdom doesn't implement it.
if (typeof Element !== "undefined" && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}

// scrollIntoView is called by Radix Select on highlight; jsdom doesn't have it.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(async () => {
  cleanup();
  // A level that unmounted walks its history entry back (lib/hooks/use-history-level.ts); let
  // that land here, not as a back gesture in the next test.
  await new Promise((resolve) => setTimeout(resolve, 0));
});
