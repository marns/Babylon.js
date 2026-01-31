import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/core";
import { PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { TreeItemValue } from "@fluentui/react-components";
import { useCallback, useRef, useState } from "react";

import type { Nullable } from "core/index";

import { GetEntityId, type EntityBase } from "./sceneExplorer";

/**
 * Drop position relative to a target item.
 */
export type DropPosition = "before" | "inside" | "after";

/**
 * Configuration for drag-drop behavior on a tree item.
 */
export type DragDropConfig<T> = {
    /**
     * Determines if a specific entity can be dragged.
     * Defaults to true for all entities if not provided.
     */
    canDrag?: (entity: T) => boolean;

    /**
     * Validates if dropping draggedEntity onto targetEntity at the given position would be valid.
     * Use this for cycle detection and other validation logic.
     * Defaults to true if not provided.
     */
    canDrop?: (draggedEntity: T, targetEntity: T, dropPosition: DropPosition) => boolean;

    /**
     * Performs the actual drop operation (reparenting, reordering, etc.).
     * Called after a successful drop.
     */
    performDrop?: (draggedEntity: T, targetEntity: T, dropPosition: DropPosition) => void;
};

/**
 * Event data for drag-drop operations in the Scene Explorer.
 * Passed to the `onDragDrop` callback when a user drops a node onto another.
 *
 * @example
 * ```typescript
 * sceneExplorerService.onDragDrop = (event) => {
 *     console.log(`Dropped ${event.draggedEntity.name} ${event.dropPosition} ${event.targetEntity.name}`);
 *     // Call preventDefault() to handle the reparenting yourself
 *     // event.preventDefault();
 * };
 * ```
 */
export type SceneExplorerDragDropEvent = {
    /**
     * The entity being dragged.
     */
    draggedEntity: EntityBase;

    /**
     * The entity being dropped onto (the drop target).
     */
    targetEntity: EntityBase;

    /**
     * Where the dragged entity will be placed relative to the target.
     */
    dropPosition: DropPosition;

    /**
     * Call this to prevent the default reparenting behavior.
     * Use this when you want to handle the drop operation yourself.
     */
    preventDefault: () => void;
};

/**
 * Tree item data needed for drag-drop operations.
 */
export interface DragDropTreeItem {
    type: "entity";
    entity: EntityBase;
    children?: DragDropTreeItem[];
    dragDropConfig?: DragDropConfig<EntityBase>;
    getDisplayInfo: () => { name: string; dispose?: () => void };
}

interface DropState<TEntity> {
    target: Nullable<TEntity>;
    position: DropPosition | null;
    draggedEntity: Nullable<TEntity>;
}

// Calculate drop position based on pointer Y within the element
// "before" (top 25%), "inside" (middle 60%), "after" (bottom 15%)
function calculateDropPosition(clientY: number, overRect: DOMRect): DropPosition {
    const relativeY = clientY - overRect.top;
    const height = overRect.height;
    if (relativeY < height * 0.25) {
        return "before";
    } else if (relativeY > height * 0.85) {
        return "after";
    }
    return "inside";
}

export interface UseSceneExplorerDragDropParams<TEntity extends EntityBase> {
    /** Map of entity IDs to tree item data */
    allTreeItems: Map<TreeItemValue, { type: string; entity?: TEntity; children?: DragDropTreeItem[]; dragDropConfig?: DragDropConfig<TEntity> }>;
    /** Set of currently expanded item IDs */
    openItems: Set<TreeItemValue>;
    /** Optional callback when a drop occurs - can call preventDefault() to handle drop yourself */
    onDragDrop?: (event: SceneExplorerDragDropEvent) => void;
    /** Called after a successful drop (when not prevented) for UI updates */
    onDropped?: (draggedEntity: TEntity, targetEntity: TEntity, dropPosition: DropPosition) => void;
}

export interface SceneExplorerDragDropResult<TEntity extends EntityBase> {
    // State for rendering
    draggedEntity: Nullable<TEntity>;
    currentDropPosition: DropPosition | null;
    currentDropTarget: Nullable<TEntity>;

    // Event handlers for DndContext
    onDragStart: (event: DragStartEvent) => void;
    onDragMove: (event: DragMoveEvent) => void;
    onDragEnd: (event: DragEndEvent) => void;
    onDragCancel: () => void;
}

/**
 * Hook that returns dnd-kit sensors configured for the scene explorer.
 * Uses a 5px distance constraint to prevent accidental drags on click.
 */
export function useDragSensors() {
    return useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
}

/**
 * Hook that encapsulates all drag-drop state and logic for the scene explorer.
 * Returns state for rendering and event handlers for DndContext.
 */
export function useSceneExplorerDragDrop<TEntity extends EntityBase>({
    allTreeItems,
    openItems,
    onDragDrop,
    onDropped,
}: UseSceneExplorerDragDropParams<TEntity>): SceneExplorerDragDropResult<TEntity> {
    // Drag state for rendering
    const [draggedEntity, setDraggedEntity] = useState<Nullable<TEntity>>(null);
    const [currentDropPosition, setCurrentDropPosition] = useState<DropPosition | null>(null);
    const [currentDropTarget, setCurrentDropTarget] = useState<Nullable<TEntity>>(null);

    // Ref to avoid stale closures in event handlers
    const dropStateRef = useRef<DropState<TEntity>>({ target: null, position: null, draggedEntity: null });

    const resetState = useCallback(() => {
        setDraggedEntity(null);
        setCurrentDropPosition(null);
        setCurrentDropTarget(null);
        dropStateRef.current = { target: null, position: null, draggedEntity: null };
    }, []);

    const onDragStart = useCallback((event: DragStartEvent) => {
        const entity = event.active.data.current?.entity as TEntity | undefined;
        if (entity) {
            setDraggedEntity(entity);
            dropStateRef.current.draggedEntity = entity;
        }
    }, []);

    const onDragMove = useCallback(
        (event: DragMoveEvent) => {
            const { over, activatorEvent } = event;
            const dragged = dropStateRef.current.draggedEntity;

            if (!over || !dragged) {
                setCurrentDropPosition(null);
                setCurrentDropTarget(null);
                dropStateRef.current.position = null;
                dropStateRef.current.target = null;
                return;
            }

            const targetEntity = over.data.current?.entity as TEntity | undefined;
            const dragDropConfig = over.data.current?.dragDropConfig as DragDropConfig<TEntity> | undefined;

            if (!targetEntity || !dragDropConfig || targetEntity === dragged) {
                setCurrentDropPosition(null);
                setCurrentDropTarget(null);
                dropStateRef.current.position = null;
                dropStateRef.current.target = null;
                return;
            }

            // Get pointer coordinates from the activator event
            const pointerEvent = activatorEvent as PointerEvent | MouseEvent | TouchEvent;
            let clientY: number;
            if ("clientY" in pointerEvent) {
                clientY = pointerEvent.clientY;
            } else if ("touches" in pointerEvent && pointerEvent.touches.length > 0) {
                clientY = pointerEvent.touches[0].clientY;
            } else {
                return;
            }

            // Calculate current pointer position using delta from drag start
            const currentY = clientY + event.delta.y;
            const overRect = over.rect;
            let dropPos = calculateDropPosition(currentY, overRect as unknown as DOMRect);

            // If "after" on an expanded node with visible children, redirect to "before" on first child
            if (dropPos === "after") {
                const targetId = GetEntityId(targetEntity);
                const targetTreeItem = allTreeItems.get(targetId);
                if (targetTreeItem?.type === "entity" && targetTreeItem.children?.length && openItems.has(targetId)) {
                    const firstChild = targetTreeItem.children[0];
                    if (firstChild.type === "entity" && firstChild.entity !== dragged) {
                        setCurrentDropPosition("before");
                        setCurrentDropTarget(firstChild.entity as TEntity);
                        dropStateRef.current.position = "before";
                        dropStateRef.current.target = firstChild.entity as TEntity;
                        return;
                    }
                }
            }

            // Validate with canDrop
            const canDrop = dragDropConfig.canDrop?.(dragged, targetEntity, dropPos) ?? true;
            if (canDrop) {
                setCurrentDropPosition(dropPos);
                setCurrentDropTarget(targetEntity);
                dropStateRef.current.position = dropPos;
                dropStateRef.current.target = targetEntity;
            } else {
                setCurrentDropPosition(null);
                setCurrentDropTarget(null);
                dropStateRef.current.position = null;
                dropStateRef.current.target = null;
            }
        },
        [allTreeItems, openItems]
    );

    const onDragEnd = useCallback(() => {
        const { target, position, draggedEntity: droppedEntity } = dropStateRef.current;

        if (target && position && droppedEntity) {
            const treeItem = allTreeItems.get(GetEntityId(droppedEntity));
            const dragDropConfig = treeItem?.type === "entity" ? treeItem.dragDropConfig : undefined;

            if (dragDropConfig) {
                // Create event for consumer callback
                let isDefaultPrevented = false;
                const event: SceneExplorerDragDropEvent = {
                    draggedEntity: droppedEntity,
                    targetEntity: target,
                    dropPosition: position,
                    preventDefault: () => {
                        isDefaultPrevented = true;
                    },
                };

                // Call consumer callback if provided
                onDragDrop?.(event);

                // If not prevented, perform the drop and notify
                if (!isDefaultPrevented) {
                    dragDropConfig.performDrop?.(droppedEntity, target, position);
                    onDropped?.(droppedEntity, target, position);
                }
            }
        }

        resetState();
    }, [allTreeItems, onDragDrop, onDropped, resetState]);

    return {
        draggedEntity,
        currentDropPosition,
        currentDropTarget,
        onDragStart,
        onDragMove,
        onDragEnd,
        onDragCancel: resetState,
    };
}
