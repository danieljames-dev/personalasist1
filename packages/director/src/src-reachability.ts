/**
 * Transitive import reachability from a root module.
 *
 * Used by the wiring assertion: a src module is on the shipped surface only
 * when it is reachable from `index.ts`. A module imported only by its test
 * is not shipped.
 */
export function modulesReachableFrom(
  root: string,
  importsByModule: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const seen = new Set<string>();
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of importsByModule.get(current) ?? []) {
      if (!seen.has(next)) stack.push(next);
    }
  }
  return seen;
}
