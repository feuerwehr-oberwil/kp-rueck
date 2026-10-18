// @vitest-environment jsdom
//
// React error #418 on a cold load of `/` and `/map` (18.10.2026), at the seam where it happens:
// a layout's route `children` that is still pending (a lazy) while hydration is inside <main>.
//
// It runs the React that ships in the production bundle – Next's vendored copy under
// `next/dist/compiled/` (19.2 canary in Next 15.5) – not the npm `react-dom` the other tests use:
// that one (19.3) already has React's fix and could not go red. No JSX here: the vitest JSX
// runtime is npm React's.
import { describe, expect, it } from "vitest";
// @ts-expect-error – Next's vendored React ships no types; the API is React's
import * as React from "next/dist/compiled/react";
// @ts-expect-error – see above
import { hydrateRoot } from "next/dist/compiled/react-dom/client";
// @ts-expect-error – see above
import { renderToString } from "next/dist/compiled/react-dom/server.node";

import { RouteSlot } from "./route-slot";

const h = React.createElement;
const page = () => h(React.Suspense, { fallback: null }, h("p", null, "Lagekarte"));

/** What the RSC client hands a layout as `children` while its row is still on its way: a lazy
 *  node over a chunk that is a thenable WITH a `status`, as React Flight's chunks are. It
 *  arrives in a microtask after React first reads it – inside the one yield React allows a
 *  suspended render before it gives up and restarts. Arriving there is what makes React REPLAY
 *  the suspended unit (`<main>`) instead, the path with the bug; in the browser that is the
 *  RSC row or a client chunk landing a moment after hydration got to `<main>`. */
function lateSlot(node: unknown) {
  const listeners: Array<(value: unknown) => void> = [];
  const chunk = {
    status: "pending" as "pending" | "fulfilled",
    value: null as unknown,
    then: (resolve: (value: unknown) => void) => void listeners.push(resolve),
  };
  const arrive = () => {
    chunk.status = "fulfilled";
    chunk.value = node;
    listeners.forEach((listener) => listener(node));
  };
  return {
    $$typeof: Symbol.for("react.lazy"),
    _payload: chunk,
    _init: (c: typeof chunk) => {
      if (c.status === "fulfilled") return c.value;
      queueMicrotask(arrive);
      throw c;
    },
  };
}

/** Server-render `<main>` with the page, then hydrate it with the page as a late slot.
 *  Returns the hydration errors and the DOM afterwards. */
async function hydrateWithLateSlot(wrap: (slot: unknown) => unknown) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(h("main", null, wrap(page())));
  document.body.appendChild(container);

  const errors: string[] = [];
  // inside startTransition, as Next's app-index hydrates: time-sliced, so a suspended unit can
  // be replayed (a sync render always restarts)
  let root!: { unmount(): void };
  React.startTransition(() => {
    root = hydrateRoot(container, h("main", null, wrap(lateSlot(page()))), {
      onRecoverableError: (error: Error) => errors.push(error.message),
    });
  });
  await new Promise((r) => setTimeout(r, 50));
  const html = container.innerHTML;
  root.unmount();
  container.remove();
  return { errors, html };
}

describe("RouteSlot", () => {
  it("hydrates a route slot that arrives late without a mismatch", async () => {
    const { errors, html } = await hydrateWithLateSlot((slot) => h(RouteSlot, null, slot));
    expect(errors).toEqual([]);
    expect(html).toContain("<main><!--$--><p>Lagekarte</p><!--/$--></main>");
  });

  // Why RouteSlot exists. If this fails after a Next/React upgrade, React's replay fix has
  // arrived (it is in the React of Next 16): RouteSlot and this file can go.
  it("is needed: the same slot straight in <main> mismatches in this React", async () => {
    const { errors } = await hydrateWithLateSlot((slot) => slot);
    expect(errors.join(" ")).toMatch(/418|Hydration failed/);
  });
});
