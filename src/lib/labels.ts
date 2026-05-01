// Helper utilities for displaying labels with their nested hierarchy (Batch 8).
//
// Labels can have a parent_label_id pointing to another label. When rendering
// chips and pickers we want to show "Parent / Child" so users see the context.

export interface LabelLike {
  id: string;
  name: string;
  parent_label_id?: string | null;
  color?: string;
  bg_color?: string;
}

/**
 * Format a label's display name:
 *   - "Parent / Child" if the label has a parent and we can find it in allLabels
 *   - Just the label's own name otherwise
 */
export function formatLabelName(
  label: LabelLike | null | undefined,
  allLabels?: LabelLike[] | null
): string {
  if (!label) return "";
  const ownName = label.name || "";
  const parentId = label.parent_label_id;
  if (!parentId || !allLabels || allLabels.length === 0) return ownName;
  const parent = allLabels.find((l) => l.id === parentId);
  if (!parent) return ownName;
  return `${parent.name} / ${ownName}`;
}

/**
 * Group labels into a parent → children map for rendering nested UI.
 * Returns:
 *   - topLevel: array of labels where parent_label_id is null
 *   - childrenByParent: map of parentId -> children sorted by name
 */
export function groupLabelsByParent<T extends LabelLike>(
  allLabels: T[]
): { topLevel: T[]; childrenByParent: Map<string, T[]> } {
  const topLevel: T[] = [];
  const childrenByParent = new Map<string, T[]>();

  for (const label of allLabels) {
    if (!label.parent_label_id) {
      topLevel.push(label);
    } else {
      const arr = childrenByParent.get(label.parent_label_id) || [];
      arr.push(label);
      childrenByParent.set(label.parent_label_id, arr);
    }
  }

  // Sort children alphabetically within each parent
  childrenByParent.forEach((children) => {
    children.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  });

  return { topLevel, childrenByParent };
}

/**
 * Get the IDs of a label and all its descendants (children).
 * Since we enforce two-level, this is just [label.id, ...children.id].
 * Used by the rule engine for the "has_label" condition with nested matching:
 * if the rule says has_label = "Brands", it should also match conversations
 * with any of Brands' children.
 */
export function getLabelAndDescendantIds<T extends LabelLike>(
  labelId: string,
  allLabels: T[]
): string[] {
  const ids = new Set<string>([labelId]);
  for (const l of allLabels) {
    if (l.parent_label_id === labelId) ids.add(l.id);
  }
  return Array.from(ids);
}