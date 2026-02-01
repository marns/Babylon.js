import type { Node } from "core/node";
import type { TransformNode } from "core/Meshes/transformNode";

import type { DragDropProvider } from "../sceneExplorerDragDrop";

/**
 * Internal drop data for node sibling ordering provider.
 */
type DropData =
    | { action: "reparent"; newParent: Node }
    | { action: "reorder"; newParent: Node | null; position: "before" | "after"; referenceNode: Node };

/**
 * Creates a drag-drop provider for Babylon.js Nodes that supports both reparenting and sibling ordering.
 * - Drop in middle zone (70%): reparent under target
 * - Drop in top zone (15%): insert before target as sibling
 * - Drop in bottom zone (15%): insert after target as sibling
 *
 * This provider handles all the Babylon.js-specific logic internally:
 * - Uses `setParent` for TransformNodes to preserve world transform
 * - Directly manipulates the internal `_children` array and `rootNodes` array
 * - Updates `_sceneRootNodesIndex` for root-level nodes
 *
 * @param isSiblingReorderDisabled - Optional function that returns true to disable sibling reordering
 *        (edge zones) and only allow reparenting. Called on each drag evaluation. Useful when the tree
 *        is sorted alphabetically, making manual ordering meaningless.
 * @returns A DragDropProvider for Node reparenting and sibling ordering
 *
 * @example
 * ```typescript
 * // Enable sibling reordering
 * sceneExplorerService.dragDropProvider = createReorderDragProvider();
 *
 * // Disable sibling reordering when sorted alphabetically
 * sceneExplorerService.dragDropProvider = createReorderDragProvider(
 *     () => sceneExplorerService.isSorted
 * );
 * ```
 */
export function createReorderDragProvider(isSiblingReorderDisabled?: () => boolean): DragDropProvider<Node, DropData> {

    return {
        canDrag: () => true,

        evaluateDrop: (dragged, target, pointerY, targetRect) => {
            // Cycle detection - can't drop onto self or descendant
            if (target === dragged || target.isDescendantOf(dragged)) {
                return { canDrop: false };
            }

            // If sibling reorder is disabled, always reparent
            if (isSiblingReorderDisabled?.()) {
                return {
                    canDrop: true,
                    visual: { type: "border" },
                    dropData: { action: "reparent", newParent: target },
                };
            }

            // Calculate relative position within target
            const relativeY = (pointerY - targetRect.top) / targetRect.height;

            if (relativeY < 0.15) {
                // Top zone: insert before target
                return {
                    canDrop: true,
                    visual: { type: "edge", edge: "top" },
                    dropData: {
                        action: "reorder",
                        newParent: target.parent,
                        position: "before",
                        referenceNode: target,
                    },
                };
            } else if (relativeY > 0.85) {
                // Bottom zone: insert after target
                return {
                    canDrop: true,
                    visual: { type: "edge", edge: "bottom" },
                    dropData: {
                        action: "reorder",
                        newParent: target.parent,
                        position: "after",
                        referenceNode: target,
                    },
                };
            } else {
                // Middle zone: reparent under target
                return {
                    canDrop: true,
                    visual: { type: "border" },
                    dropData: { action: "reparent", newParent: target },
                };
            }
        },

        onDrop: (dragged, _target, dropData) => {
            if (dropData.action === "reparent") {
                // Simple reparenting
                if (dragged.parent !== dropData.newParent) {
                    setNodeParent(dragged, dropData.newParent);
                }
            } else {
                // Sibling reordering
                const { newParent, position, referenceNode } = dropData;

                // First, reparent if needed
                if (dragged.parent !== newParent) {
                    setNodeParent(dragged, newParent);
                }

                // Then, reorder within siblings
                const siblings = getChildrenArray(newParent, dragged);

                if (siblings) {
                    const draggedIndex = siblings.indexOf(dragged);
                    const referenceIndex = siblings.indexOf(referenceNode);

                    if (draggedIndex !== -1 && referenceIndex !== -1 && draggedIndex !== referenceIndex) {
                        // Remove from current position
                        siblings.splice(draggedIndex, 1);

                        // Calculate insertion index (adjust if dragged was before reference)
                        let insertIndex = draggedIndex < referenceIndex ? referenceIndex - 1 : referenceIndex;
                        if (position === "after") {
                            insertIndex++;
                        }

                        // Insert at new position
                        siblings.splice(insertIndex, 0, dragged);

                        // Update root node indices if at root level
                        if (!newParent) {
                            updateRootNodeIndices(siblings);
                        }
                    }
                }
            }
        },
    };
}

/**
 * Sets a node's parent, using setParent for TransformNodes to preserve world transform.
 */
function setNodeParent(node: Node, parent: Node | null): void {
    // Check if node has setParent method (TransformNode and subclasses)
    if ("setParent" in node && typeof (node as TransformNode).setParent === "function") {
        (node as TransformNode).setParent(parent);
    } else {
        node.parent = parent;
    }
}

/**
 * Gets the mutable children array for a parent node, or the scene's rootNodes for root-level.
 */
function getChildrenArray(parent: Node | null, node: Node): Node[] | null {
    if (parent) {
        // Access internal _children array
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (parent as any)._children as Node[] | null;
    } else {
        // Root level - use scene's rootNodes
        return node.getScene().rootNodes;
    }
}

/**
 * Updates the cached _sceneRootNodesIndex for all root nodes after reordering.
 */
function updateRootNodeIndices(rootNodes: Node[]): void {
    rootNodes.forEach((node, index) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (node as any)._nodeDataStorage._sceneRootNodesIndex = index;
    });
}
