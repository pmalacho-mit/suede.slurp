// The runtime as Vitest gets it: the plugin resolves `common.svelte.ts` here
// under Vitest, so a generated component's `define` registers a test.
import { expect, onTestFinished, test, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import type { Component } from "svelte";
import { createHarness, type Harness, type Meta } from "./common.svelte.ts";

export * from "./common.svelte.ts";

/**
 * jsdom has no Web Animations API, and a Svelte transition is one: without it
 * an outro never ends and the element never leaves. Under jsdom, every
 * animation finishes on the next tick — what the DOM shows is what the
 * transition would have left behind.
 */
function finishAnimationsAtOnce() {
  if (
    typeof navigator === "undefined" ||
    !navigator.userAgent.includes("jsdom")
  )
    return;
  const proto = Element.prototype as Element & {
    animate?: unknown;
    getAnimations?: unknown;
  };
  proto.animate = function (
    this: Element,
    _keyframes: unknown,
    options?: number | KeyframeAnimationOptions,
  ) {
    const duration =
      typeof options === "number" ? options : Number(options?.duration ?? 0);
    const animation = {
      playState: "running" as AnimationPlayState,
      currentTime: 0 as number | null,
      onfinish: null as
        | ((this: Animation, ev: AnimationPlaybackEvent) => void)
        | null,
      cancel() {
        animation.playState = "idle";
      },
      finish() {
        animation.playState = "finished";
        animation.currentTime = duration;
        animation.onfinish?.call(
          animation as unknown as Animation,
          {} as AnimationPlaybackEvent,
        );
      },
    };
    setTimeout(
      () => animation.playState === "running" && animation.finish(),
      0,
    );
    return animation as unknown as Animation;
  };
  proto.getAnimations = () => [];
}

finishAnimationsAtOnce();

/** Registers a generated component as one Vitest test; an example (no `Test` parameter) passes by mounting without throwing. */
export const define = (
  Self: () => Component<{ harness: Harness }>,
  meta: Meta,
): void => {
  test(meta.name, async (context) => {
    const harness = createHarness(
      meta.name,
      {
        expect,
        vi,
        context,
        user: userEvent.setup(),
        screen,
        within,
        fireEvent,
        waitFor,
        // a note is a Vitest annotation too, so reporters see it
        onNote: (text) => void context.annotate(text),
      },
      meta.test !== false,
    );
    const rendered = render(Self(), { props: { harness } });
    onTestFinished(() => rendered.unmount());
    await harness.run();
    // an example's test is that it mounted; said as an assertion, for a project that requires one
    if (meta.test === false)
      expect(
        rendered.container.hasChildNodes(),
        "the example mounted nothing",
      ).toBe(true);
  });
};
