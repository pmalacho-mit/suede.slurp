# Requirements

Everything `URLParameterize` must do, each with the tests that show it does.
A test is cited as `file › name`: a namespace test (`export type name`) in a
module under `release/`, a snippet test (`{#snippet name(`) in an example, or
a Vitest test (`test("name…`). `src/requirements.test.ts` fails if a
requirement cites no test, or cites one that does not exist.

## Mounting

- **R1. It starts from the URL.** A property whose parameter is in the URL takes its value from it.
  `release/URLParameterize.svelte.ts › ReadsTheURL`
- **R2. It writes what the URL lacks, without an entry.** A property whose parameter is not in the URL keeps its initial value, which is written to the URL by replacing the current entry, so mounting never costs a press of Back.
  `release/URLParameterize.svelte.ts › WritesInitialValues`
- **R3. Mounting is one call.** Every initial value is written in one call to the History API.
  `release/URLParameterize.svelte.ts › MountsInOneCall`
- **R4. History is patched once per page.** However many copies of the module load (a hot reload, two versions in one bundle), `pushState` and `replaceState` are patched once, and every copy hears every change. The test environment loads the module once per test, so a count of exactly one call per write shows it.
  `release/URLParameterize.svelte.ts › MountsInOneCall`, `release/URLParameterize.svelte.ts › OneActionOneCall`
- **R5. Outside a browser it does nothing, safely.** On a server, importing and calling it does not throw, `cleanup` and `prefix` do nothing, and `key` still tells where a property would be stored. (A browser without the History API takes the same path, and logs an error.)
  `release/utils.ts › URLParameterizeDisabled`, `release/utils.ts › KeyOutsideABrowser`

## Writing

- **R6. A change is a history entry.** By default, each change adds an entry, so Back undoes it.
  `release/URLParameterize.svelte.ts › WritesChanges`
- **R7. `history: "replace"` adds none.** A handler's own setting wins over the options', which win over the default.
  `release/URLParameterize.svelte.ts › ReplacesHistory`, `release/handlers.ts › Precedence`
- **R8. One action is one entry.** Whatever one action changes (one event handler, one tick), across properties and tracked objects, is one entry, and one press of Back undoes all of it.
  `release/URLParameterize.svelte.ts › OneActionOneEntry`, `release/URLParameterize.svelte.ts › SideBySideOneEntry`, `src/examples/Workbench.svelte › backUndoesOneAction`
- **R9. One action is one call.** However many properties an action changes, it calls the History API once, so it stays under browsers' rate limits (Safari throws after 100 calls in 30 seconds).
  `release/URLParameterize.svelte.ts › OneActionOneCall`, `src/examples/stress.test.ts › an action that changes all 400 parameters`
- **R10. Changes inside a value are written.** Pushing onto an array or assigning into an object a property holds is written, as assigning the property is.
  `release/URLParameterize.svelte.ts › WritesDeepChanges`
- **R11. Nothing changed, nothing written.** Assigning a property the value it has, or the value the URL already holds, writes nothing.
  `release/URLParameterize.svelte.ts › UnchangedNotWritten`, `release/params.ts › Writes`, `release/params.ts › NoEcho`
- **R12. `undefined` leaves the URL.** A value that serializes to `undefined` removes its parameter.
  `release/URLParameterize.svelte.ts › RemovesUndefined`, `release/handlers.ts › Undefined`
- **R13. The pipeline.** Writing is `serialize` then `encode`; reading is `decode`, `deserialize`, then `resolve`. The URL percent-encodes once.
  `release/handlers.ts › RoundTrip`, `release/handlers.ts › Values`, `release/params.ts › EncodesOnce`
- **R14. Arrays as repeated parameters.** With `entries: "multiple"`, an array is written as one parameter per entry, each serialized on its own.
  `release/URLParameterize.svelte.ts › RepeatsEntries`, `release/handlers.ts › Entries`
- **R15. The rest of the URL is left alone.** A write changes only its own parameters: the path, the other parameters (and how they are written) and the other part of the URL stay, and a changed parameter keeps its place. A query or hash left empty goes, `?` or `#` with it.
  `release/params.ts › Changes`, `release/params.ts › InPlace`, `release/params.ts › Unchanged`, `release/params.ts › Empties`
- **R16. Others' navigation goes after.** Code that pushes a URL in the same action as a change goes after it: the change keeps an entry of its own.
  `release/URLParameterize.svelte.ts › OthersGoAfter`
- **R17. Others' history state is kept.** Replacing an entry keeps the `history.state` a router keeps there.
  `release/URLParameterize.svelte.ts › KeepsHistoryState`

## Reading

- **R18. Back and forward bring values back.**
  `release/URLParameterize.svelte.ts › FollowsHistory`
- **R19. Others' changes to the URL are read, and not written back.** A link, `pushState`, or `replaceState` from other code.
  `release/URLParameterize.svelte.ts › FollowsNavigation`, `release/params.ts › NoEcho`
- **R20. A parameter that leaves the URL is resolved from `undefined`,** and not written back. One missing when tracking starts leaves the initial value instead.
  `release/URLParameterize.svelte.ts › ResolvesRemoved`, `release/params.ts › Removed`, `release/params.ts › InitialKept`
- **R21. Text typed by hand reads as text,** and stays as it was written until the property changes.
  `release/URLParameterize.svelte.ts › ReadsText`, `release/handlers.ts › NotJSON`, `release/params.ts › NotRewritten`
- **R22. Old links still read.** Values percent-encoded twice, by earlier versions, read with the default `deserialize`.
  `release/URLParameterize.svelte.ts › ReadsLegacyLinks`, `release/handlers.ts › Legacy`
- **R23. A value that cannot be read is reported,** with `console.error`, and the property keeps what it had.
  `release/URLParameterize.svelte.ts › ReportsUnreadable`, `release/params.ts › Unreadable`
- **R24. Arrays are read whole or not at all.** One entry of several that cannot be read leaves the property as it was, and nothing is written back.
  `release/URLParameterize.svelte.ts › ReadsEntriesAtomically`
- **R25. What is read is seen.** An array read from the URL is assigned, so markup sees it whether the property is `$state` or `$state.raw`.
  `release/URLParameterize.svelte.ts › ReadsIntoRawState`
- **R26. Arrays follow the URL's length.** Entries the URL drops go; a property that is not an array yet becomes one.
  `release/params.ts › Shrinks`, `release/params.ts › Creates`
- **R27. A single value repeated reads its first.**
  `release/params.ts › FirstOfDuplicates`
- **R28. `resolve` is handed the deserialized value, the parameter, and the entry's index.**
  `release/handlers.ts › Resolves`
- **R29. `resolve` runs only for what changed.** An unchanged URL is not read again, and an array's unchanged entries keep their value.
  `release/params.ts › ReadOnce`, `release/params.ts › KeepsUnchanged`

## The hash

- **R30. Parameters can live in the hash,** per handler or for every handler, written as they are in the query.
  `release/URLParameterize.svelte.ts › StoresInTheHash`, `release/URLParameterize.svelte.ts › ObjectInTheHash`, `release/handlers.ts › In`, `release/params.ts › Hash`
- **R31. Changing the hash is read,** whether by a link, `location.hash`, or the address bar, in browsers that announce it with `hashchange` alone too; Back undoes it.
  `release/URLParameterize.svelte.ts › FollowsHashChange`, `release/URLParameterize.svelte.ts › ListensForHashChange`
- **R32. A parameter moved to the hash still reads links with it in the query,** and moves it.
  `release/URLParameterize.svelte.ts › MovesToTheHash`, `release/params.ts › QueryToHash`

## Keys and prefixes

- **R33. A key is the prefix, then the handler's key or the property's name.**
  `release/URLParameterize.svelte.ts › Keys`, `release/handlers.ts › Prefix`
- **R34. `key()` tells a property's parameter,** reactively, as the prefix moves.
  `release/URLParameterize.svelte.ts › Key`
- **R35. Prefixes move every parameter at once, without an entry,** whether by `prefix()` or a prefix getter, and later changes follow.
  `release/URLParameterize.svelte.ts › MovesPrefix`, `release/URLParameterize.svelte.ts › FollowsPrefixGetter`
- **R36. A change waiting when the prefix moves is written under the new key,** and the old key is not brought back.
  `release/URLParameterize.svelte.ts › PrefixTakesWaitingChange`
- **R37. Keys are unique.** A key tracked twice throws, on mount, within one call, or by moving a prefix.
  `release/URLParameterize.svelte.ts › Conflicts`, `release/URLParameterize.svelte.ts › ConflictsWithinACall`, `release/params.ts › Conflict`
- **R38. A conflict leaves nothing behind.** Once the holder is cleaned up, every key is free again.
  `release/URLParameterize.svelte.ts › ConflictLeavesNothing`
- **R39. Objects tracked side by side leave each other alone.**
  `release/URLParameterize.svelte.ts › SideBySide`

## Debouncing

- **R40. Debounced changes are written once they pause,** as one entry, and a burst that never pauses still every `maxWaitMs`.
  `release/URLParameterize.svelte.ts › Debounces`, `release/debounce.ts › BurstRunsLatestOnce`, `release/debounce.ts › MaxWaitCapsABurst`, `release/debounce.ts › KeysAreIndependent`
- **R41. The options' debounce applies to every handler;** a handler's own overrides it, and `debounce: false` opts out.
  `release/URLParameterize.svelte.ts › GlobalDebounce`, `release/debounce.ts › PerCallConfig`
- **R42. `maxWaitMs` may not be shorter than `idleMs`.**
  `release/debounce.ts › AcceptsEqualWaits`, `release/debounce.ts › RejectsShorterMaxWait`, `release/debounce.ts › ConstructorValidates`, `release/debounce.ts › PerCallConfigValidated`
- **R43. A debounced change goes with its action.** Made in the same action as other changes, it is written at once, in their entry.
  `release/URLParameterize.svelte.ts › DebouncedJoinsItsAction`, `release/URLParameterize.svelte.ts › DebouncedFirstJoinsItsAction`
- **R44. History keeps the order things were done in.** A change still waiting when a later one is written goes first, in an entry of its own.
  `release/URLParameterize.svelte.ts › EarlierChangeFirst`
- **R45. Back and forward drop a change still waiting:** the URL arrived at is read instead, and the forward entry is kept.
  `release/URLParameterize.svelte.ts › BackDropsWaitingChange`, `src/examples/Workbench.svelte › backUndoesOneAction`
- **R46. A link followed while a change waits keeps it,** and it is written to the entry the link added.
  `release/URLParameterize.svelte.ts › LinkKeepsWaitingChange`
- **R47. A change undone before it is written writes nothing.**
  `release/URLParameterize.svelte.ts › UndoneBeforeWritten`
- **R48. Leaving the page writes waiting changes at once** (`visibilitychange`, `pagehide`, `beforeunload`).
  `release/URLParameterize.svelte.ts › LeavingWrites`, `release/debounce.ts › LeavingFlushes`

## Migrating keys

- **R49. Old keys are read and removed.** An old key in the URL is applied (unless `apply: false`) and removed (unless `remove: false`), by replacing the entry or, with `behavior: "push"`, in an entry of its own; `in` says where to look.
  `release/URLParameterize.svelte.ts › MigratesKeys`, `release/URLParameterize.svelte.ts › MigratesWithAnEntry`, `release/params.ts › Migrates`, `release/params.ts › Absent`

## Cleaning up

- **R50. Cleanup removes the parameters, without an entry, and stops tracking.** `onDestroy` in the options calls it when the component goes.
  `release/URLParameterize.svelte.ts › CleansUp`, `src/examples/Workbench.svelte › tracksEverything`
- **R51. Cleanup drops changes not yet written,** waiting out a debounce or made in the same action, and calling it again does nothing.
  `release/URLParameterize.svelte.ts › CleanupDropsWaitingChanges`, `release/URLParameterize.svelte.ts › CleanupInTheSameAction`
- **R52. Cleanup leaves another page's parameters alone.** Once the URL's path is not the one the parameters were written on (a router navigated, then unmounted), they are not removed.
  `release/URLParameterize.svelte.ts › CleanupLeavesOtherPages`

## A whole app

- **R53. An app can be rebuilt from its URL alone.** Every kind of control, in every part of the URL.
  `src/examples/Workbench.svelte › tracksEverything`
- **R54. Large values can stay out of the query,** in the hash, which is never sent to a server.
  `src/examples/Workbench.svelte › longQuery`, `src/examples/Workbench.svelte › filesInHash`

## Performance

- **R55. A change costs about what the browser's own URL update does,** with hundreds of parameters tracked.
  `src/examples/stress.test.ts › a change costs about what the browser's own URL update does`
- **R56. Mounting grows in step with the number of parameters.**
  `src/examples/stress.test.ts › mounting grows in step with the number of parameters`
- **R57. An action that changes every parameter costs about what a few changes do,** in one call.
  `src/examples/stress.test.ts › an action that changes all 400 parameters`
