export interface RootRouteClaim {
  id: string;
  source: string;
}

/** Fail closed when a legal/blog collection route cannot be served unambiguously. */
export function assertUniqueRootRouteClaims(reserved: Iterable<string>, claims: RootRouteClaim[]): void {
  const reservedNames = new Set(reserved);
  const claimed = new Map<string, string>();

  for (const { id, source } of claims) {
    if (!id || id.includes('/') || id.includes('\\')) {
      throw new Error(`${source} must use one root-level slug segment; received "${id}".`);
    }
    if (reservedNames.has(id)) {
      throw new Error(`${source} would be served at /${id}/, but a static route already claims that path.`);
    }
    const previous = claimed.get(id);
    if (previous) {
      throw new Error(`Route collision at /${id}/: ${previous} and ${source} both claim the same URL.`);
    }
    claimed.set(id, source);
  }
}
