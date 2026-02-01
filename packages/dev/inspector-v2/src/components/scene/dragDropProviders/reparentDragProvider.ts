import type { DragDropProvider } from "../sceneExplorerDragDrop";

/**
 * Internal drop data for reparent-only provider.
 */
type DropData<T> = {
    newParent: T;
};

/**
 * Creates a simple drag-drop provider that only supports reparenting.
 * Dropping anywhere on a target makes the target the new parent.
 * Shows a border visual around the drop target.
 *
 * @param setParent - Function to set an entity's parent
 * @param isDescendantOf - Function to check if an entity is a descendant of another
 * @returns A DragDropProvider for reparenting
 *
 * @example
 * ```typescript
 * const provider = createReparentDragProvider<Node>(
 *     (node, parent) => (node as TransformNode).setParent(parent),
 *     (node, ancestor) => node.isDescendantOf(ancestor)
 * );
 * ```
 */
export function createReparentDragProvider<T>(
    setParent: (entity: T, newParent: T | null) => void,
    isDescendantOf: (entity: T, potentialAncestor: T) => boolean
): DragDropProvider<T, DropData<T>> {
    return {
        canDrag: () => true,

        evaluateDrop: (dragged, target) => {
            // Cycle detection - can't drop onto self or descendant
            if (target === dragged || isDescendantOf(target, dragged)) {
                return { canDrop: false };
            }
            return {
                canDrop: true,
                visual: { type: "border" },
                dropData: { newParent: target },
            };
        },

        onDrop: (dragged, _target, { newParent }) => {
            setParent(dragged, newParent);
        },
    };
}
