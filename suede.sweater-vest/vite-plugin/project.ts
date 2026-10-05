import type { TestProjectInlineConfiguration } from "vitest/config";

/** The name the plugin collects components in, unless told another. */
export const DEFAULT_PROJECT = "sweater-vest";

/** The DOM a project's tests run against. */
export type Environment = "jsdom" | "happy-dom";

/** What a project may add without breaking what the plugin needs: setup files, timeouts, globals… */
export type Extra = Omit<
  NonNullable<TestProjectInlineConfiguration["test"]>,
  "name" | "environment" | "include"
>;

/**
 * The Vitest project snippet tests run in, spelled out so the type says exactly
 * what it is. Each part is load-bearing:
 * - `extends: true` inherits your root config, plugins included (the plugin among them);
 * - the `browser` condition makes Svelte resolve its client build, as a DOM test needs;
 * - `include: []` because components are collected by the plugin (as in-source tests), not by glob.
 */
export type SweaterVestProject<
  Name extends string,
  Env extends Environment,
  More extends Extra,
> = {
  extends: true;
  resolve: { conditions: ["browser"] };
  test: { name: Name; environment: Env; include: [] } & More;
};

export type ProjectOptions<
  Name extends string,
  Env extends Environment,
  More extends Extra,
> = {
  /** Default `"sweater-vest"`. Another name needs the same `project` given to the plugin. */
  name?: Name;
  /** Default `"jsdom"`. `"happy-dom"` needs `happy-dom` installed. */
  environment?: Env;
  /** Anything else for this project's `test`: `setupFiles`, `testTimeout`, `globals`… */
  test?: More;
};

/**
 * The Vitest project for snippet tests: put it in `test.projects`.
 */
export const project = <
  const Name extends string = typeof DEFAULT_PROJECT,
  const Env extends Environment = "jsdom",
  const More extends Extra = {},
>(
  options: ProjectOptions<Name, Env, More> = {},
) =>
  ({
    extends: true,
    resolve: { conditions: ["browser"] },
    test: {
      ...(options.test as More),
      name: (options.name ?? DEFAULT_PROJECT) as Name,
      environment: (options.environment ?? "jsdom") as Env,
      include: [],
    },
  }) as const satisfies SweaterVestProject<Name, Env, More>;

import type {
  Expect,
  Invoke,
} from "../../suede.nests.sweater-vest/dsl.import.meta.vitest.ts";

declare namespace project {
  /** with nothing given: the default name, jsdom, and only what the plugin collects */
  export type Defaults = Expect<
    Invoke<typeof project, []>,
    "=",
    {
      extends: true;
      resolve: { conditions: ["browser"] };
      test: { name: "sweater-vest"; environment: "jsdom"; include: [] };
    }
  >;

  /** a name, an environment and extras come through as given, and `include` stays empty */
  export type Given = Expect<
    Invoke<
      typeof project,
      [{ name: "dom"; environment: "happy-dom"; test: { testTimeout: 10000 } }]
    >,
    "matches",
    {
      test: {
        name: "dom";
        environment: "happy-dom";
        include: [];
        testTimeout: 10000;
      };
    }
  >;
}
