// Fold logic for the sidebar outline. Headings arrive as a flat list of
// levels; a heading's descendants are the deeper headings that follow it,
// up to the next heading of the same or a higher level (H1 then H3 nests the
// H3 under the H1; H3 then H2 does not nest).

/** Whether each heading has at least one descendant (and so can fold). */
export function hasDescendants(levels: readonly number[]): boolean[] {
  return levels.map((level, i) => i + 1 < levels.length && levels[i + 1] > level);
}

/** Whether each heading is hidden because some ancestor is folded. */
export function hiddenByFolds(levels: readonly number[], folded: readonly boolean[]): boolean[] {
  const foldedAncestors: number[] = []; // levels of the open folded ancestors
  return levels.map((level, i) => {
    while (foldedAncestors.length && foldedAncestors[foldedAncestors.length - 1] >= level) {
      foldedAncestors.pop();
    }
    const hidden = foldedAncestors.length > 0;
    if (folded[i]) {foldedAncestors.push(level);}
    return hidden;
  });
}

/**
 * The heading to show as active when `index` may be hidden. Everything
 * between a folded heading and its hidden descendant is hidden too, so the
 * nearest visible heading before `index` is its nearest visible ancestor.
 * -1 when `index` is -1 or nothing before it is visible.
 */
export function nearestVisibleIndex(hidden: readonly boolean[], index: number): number {
  for (let i = index; i >= 0; i--) {
    if (!hidden[i]) {return i;}
  }
  return -1;
}
