import type { Nullable } from "core/index";

import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/core";

import { PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useCallback, useRef, useState } from "react";


// =============================================================================
// Provider-based drag-drop types
// =============================================================================

/**
 * Visual style for a drop target. The provider returns this to control
 * what visual feedback is shown during drag.
 */
export type DropVisual =
    | { type: "border" } // Full border around target (for reparenting)
    | { type: "edge"; edge: "top" | "bottom" } // Line at top or bottom edge (for sibling ordering)
    | { type: "none" }; // Valid drop but no visual indicator

/**
 * Result of evaluating a potential drop target.
 * Returned by DragDropProvider.evaluateDrop().
 */
export type DropEvaluation<TDropData = unknown> =
    | {
          /** This is a valid drop target */
          canDrop: true;
          /** Visual feedback to show */
          visual: DropVisual;
          /** Opaque data passed to onDrop - provider defines the meaning */
          dropData: TDropData;
      }
    | {
          /** This is not a valid drop target */
          canDrop: false;
      };

/**
 * Defines how drag-drop behaves for a tree section.
 * Implement this interface to customize zone calculation, visual feedback, and drop handling.
 *
 * @typeParam T - The entity type (e.g., Node)
 * @typeParam TDropData - The type of data passed from evaluateDrop to onDrop
 *
 * @example
 * ```typescript
 * // Simple reparent-only provider
 * const provider: DragDropProvider<Node, { newParent: Node }> = {
 *     canDrag: () => true,
 *     evaluateDrop: (dragged, target) => ({
 *         canDrop: !target.isDescendantOf(dragged),
 *         visual: { type: "border" },
 *         dropData: { newParent: target },
 *     }),
 *     onDrop: (dragged, target, { newParent }) => {
 *         dragged.setParent(newParent);
 *     },
 * };
 * ```
 */
export interface DragDropProvider<T, TDropData = unknown> {
    /**
     * Whether this entity can be dragged.
     * Called once when a drag starts.
     */
    canDrag(entity: T): boolean;

    /**
     * Evaluate a potential drop target.
     * Called continuously as the user drags over items.
     *
     * @param draggedEntity - The entity being dragged
     * @param targetEntity - The potential drop target
     * @param pointerY - Current Y coordinate of the pointer
     * @param targetRect - Bounding rectangle of the target element
     * @returns Evaluation result with canDrop, visual feedback, and drop data
     */
    evaluateDrop(draggedEntity: T, targetEntity: T, pointerY: number, targetRect: DOMRect): DropEvaluation<TDropData>;

    /**
     * Execute the drop operation.
     * Called when the user releases over a valid drop target.
     *
     * @param draggedEntity - The entity that was dragged
     * @param targetEntity - The drop target
     * @param dropData - The data returned from evaluateDrop
     */
    onDrop(draggedEntity: T, targetEntity: T, dropData: TDropData): void;
}

type DropState<T, TDropData = unknown> = {
    target: Nullable<T>;
    visual: DropVisual | null;
    dropData: TDropData | null;
    draggedEntity: Nullable<T>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider: DragDropProvider<T, any> | null;
};

/** Result of a completed drop operation */
export type DropResult<T> = {
    draggedEntity: T;
    targetEntity: T;
    /** The visual that was shown at drop time */
    dropVisual: DropVisual;
};

type SceneExplorerDragDropResult<T> = {
    // State for rendering
    draggedEntity: Nullable<T>;
    currentDropVisual: DropVisual | null;
    currentDropTarget: Nullable<T>;
    /** Set after a successful drop (not prevented). Reset to null on next drag start. */
    lastDropResult: Nullable<DropResult<T>>;

    // Event handlers for DndContext
    onDragStart: (event: DragStartEvent) => void;
    onDragMove: (event: DragMoveEvent) => void;
    onDragEnd: (event: DragEndEvent) => void;
    onDragCancel: () => void;
};

/**
 * Hook that returns dnd-kit sensors configured for the scene explorer.
 * Uses a 5px distance constraint to prevent accidental drags on click.
 * @returns DndContext sensors
 */
export function useDragSensors() {
    return useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
}

/**
 * Hook that encapsulates all drag-drop state and logic for the scene explorer.
 * @returns state for rendering and event handlers for DndContext.
 */
export function useSceneExplorerDragDrop<T>(): SceneExplorerDragDropResult<T> {
    // Drag state for rendering
    const [draggedEntity, setDraggedEntity] = useState<Nullable<T>>(null);
    const [currentDropVisual, setCurrentDropVisual] = useState<DropVisual | null>(null);
    const [currentDropTarget, setCurrentDropTarget] = useState<Nullable<T>>(null);
    const [lastDropResult, setLastDropResult] = useState<Nullable<DropResult<T>>>(null);

    // Ref to avoid stale closures in event handlers
    const dropStateRef = useRef<DropState<T>>({ target: null, visual: null, dropData: null, draggedEntity: null, provider: null });

    const resetState = useCallback(() => {
        setDraggedEntity(null);
        setCurrentDropVisual(null);
        setCurrentDropTarget(null);
        dropStateRef.current = { target: null, visual: null, dropData: null, draggedEntity: null, provider: null };
    }, []);

    const onDragStart = useCallback(
        (event: DragStartEvent) => {
            const entity = event.active.data.current?.entity as T | undefined;
            if (!entity) {
                return;
            }

            // Clear previous drop result when starting a new drag
            setLastDropResult(null);

            // Check provider-level canDrag
            const provider = event.active.data.current?.provider as DragDropProvider<T, unknown> | undefined;
            const providerCanDrag = provider?.canDrag(entity) ?? true;

            if (providerCanDrag) {
                setDraggedEntity(entity);
                dropStateRef.current.draggedEntity = entity;
            }
            // If canDrag returns false, we don't set draggedEntity, effectively canceling the drag
        },
        []
    );

    const onDragMove = useCallback(
        (event: DragMoveEvent) => {
            const { over, activatorEvent } = event;
            const dragged = dropStateRef.current.draggedEntity;

            const clearDropState = () => {
                setCurrentDropVisual(null);
                setCurrentDropTarget(null);
                dropStateRef.current.visual = null;
                dropStateRef.current.dropData = null;
                dropStateRef.current.target = null;
                dropStateRef.current.provider = null;
            };

            if (!over || !dragged) {
                clearDropState();
                return;
            }

            const targetEntity = over.data.current?.entity as T | undefined;
            const provider = over.data.current?.provider as DragDropProvider<T, unknown> | undefined;

            if (!targetEntity || !provider || targetEntity === dragged) {
                clearDropState();
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
            const overRect = over.rect as unknown as DOMRect;

            // Ask the provider to evaluate this drop
            const evaluation = provider.evaluateDrop(dragged, targetEntity, currentY, overRect);

            if (evaluation.canDrop) {
                setCurrentDropVisual(evaluation.visual);
                setCurrentDropTarget(targetEntity);
                dropStateRef.current.visual = evaluation.visual;
                dropStateRef.current.dropData = evaluation.dropData;
                dropStateRef.current.target = targetEntity;
                dropStateRef.current.provider = provider;
            } else {
                clearDropState();
            }
        },
        []
    );

    const onDragEnd = useCallback(() => {
        const { target, visual, dropData, draggedEntity: droppedEntity, provider } = dropStateRef.current;

        if (target && visual && dropData !== null && droppedEntity && provider) {
            // Perform the drop
            provider.onDrop(droppedEntity, target, dropData);
            setLastDropResult({ draggedEntity: droppedEntity, targetEntity: target, dropVisual: visual });
        }

        resetState();
    }, [resetState]);

    return {
        draggedEntity,
        currentDropVisual,
        currentDropTarget,
        lastDropResult,
        onDragStart,
        onDragMove,
        onDragEnd,
        onDragCancel: resetState,
    };
}
