import type { Nullable } from "core/index";

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

    // Helper to create drag props for an element
    createDragProps: (
        entity: T,
        provider: DragDropProvider<T, unknown> | undefined,
        getName: () => string
    ) => {
        draggable: boolean;
        onDragStart: (e: React.DragEvent) => void;
        onDragEnd: (e: React.DragEvent) => void;
        onDragOver: (e: React.DragEvent) => void;
        onDragLeave: (e: React.DragEvent) => void;
        onDrop: (e: React.DragEvent) => void;
    };
};

// Global drag state - used to pass entity data between drag events
// HTML5 drag/drop doesn't allow reading dataTransfer in dragover events
let globalDragState: {
    entity: unknown;
    provider: DragDropProvider<unknown, unknown> | undefined;
} | null = null;

/**
 * Hook that encapsulates all drag-drop state and logic for the scene explorer.
 * Uses vanilla HTML5 drag and drop APIs.
 * @returns state for rendering and helper to create drag props.
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

    const createDragProps = useCallback(
        (entity: T, provider: DragDropProvider<T, unknown> | undefined, getName: () => string) => {
            const onDragStart = (e: React.DragEvent) => {
                // Check provider-level canDrag
                const providerCanDrag = provider?.canDrag(entity) ?? true;
                if (!providerCanDrag || !provider) {
                    e.preventDefault();
                    return;
                }

                // Clear previous drop result when starting a new drag
                setLastDropResult(null);

                // Store entity in global state (dataTransfer is write-only during dragover)
                globalDragState = { entity, provider: provider as DragDropProvider<unknown, unknown> };

                setDraggedEntity(entity);
                dropStateRef.current.draggedEntity = entity;

                // Set drag data and image
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", getName());

                // Create a custom drag image
                const dragImage = document.createElement("div");
                dragImage.textContent = getName();
                dragImage.style.cssText = `
                    position: absolute;
                    top: -1000px;
                    left: -1000px;
                    padding: 4px 8px;
                    background: var(--colorNeutralBackground1, #fff);
                    border-radius: 4px;
                    font-family: inherit;
                    font-size: inherit;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                    pointer-events: none;
                    white-space: nowrap;
                `;
                document.body.appendChild(dragImage);
                e.dataTransfer.setDragImage(dragImage, 0, 0);

                // Clean up the drag image element after a short delay
                setTimeout(() => document.body.removeChild(dragImage), 0);
            };

            const onDragEnd = () => {
                // Clean up - the actual drop is handled in onDrop for immediate feedback
                globalDragState = null;
                resetState();
            };

            const onDragOver = (e: React.DragEvent) => {
                const dragged = globalDragState?.entity as T | undefined;
                const dragProvider = globalDragState?.provider as DragDropProvider<T, unknown> | undefined;

                if (!dragged || !provider || !dragProvider || entity === dragged) {
                    return;
                }

                // Prevent default to allow drop - MUST be called for onDrop to fire
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";

                // Get pointer coordinates
                const pointerY = e.clientY;
                const targetRect = e.currentTarget.getBoundingClientRect();

                // Ask the provider to evaluate this drop
                const evaluation = dragProvider.evaluateDrop(dragged, entity, pointerY, targetRect);

                if (evaluation.canDrop) {
                    setCurrentDropVisual(evaluation.visual);
                    setCurrentDropTarget(entity);
                    dropStateRef.current.visual = evaluation.visual;
                    dropStateRef.current.dropData = evaluation.dropData;
                    dropStateRef.current.target = entity;
                    dropStateRef.current.provider = dragProvider;
                } else {
                    setCurrentDropVisual(null);
                    setCurrentDropTarget(null);
                    dropStateRef.current.visual = null;
                    dropStateRef.current.dropData = null;
                    dropStateRef.current.target = null;
                    dropStateRef.current.provider = null;
                }
            };

            const onDragLeave = (e: React.DragEvent) => {
                // Only clear visual state if we're actually leaving this element (not entering a child)
                // Don't clear dropStateRef - that's needed for onDragEnd to complete the drop
                const relatedTarget = e.relatedTarget as Element | null;
                if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
                    if (dropStateRef.current.target === entity) {
                        setCurrentDropVisual(null);
                        setCurrentDropTarget(null);
                    }
                }
            };

            const onDrop = (e: React.DragEvent) => {
                e.preventDefault();
                e.stopPropagation();

                // Perform the drop immediately for responsive feedback
                const { target, visual, dropData, draggedEntity: droppedEntity, provider: dropProvider } = dropStateRef.current;

                if (target && visual && dropData !== null && droppedEntity && dropProvider) {
                    dropProvider.onDrop(droppedEntity, target, dropData);
                    setLastDropResult({ draggedEntity: droppedEntity, targetEntity: target, dropVisual: visual });
                }

                // Clear all state immediately - don't wait for onDragEnd
                globalDragState = null;
                dropStateRef.current = { target: null, visual: null, dropData: null, draggedEntity: null, provider: null };
                setDraggedEntity(null);
                setCurrentDropVisual(null);
                setCurrentDropTarget(null);
            };

            return {
                draggable: !!provider,
                onDragStart,
                onDragEnd,
                onDragOver,
                onDragLeave,
                onDrop,
            };
        },
        [resetState]
    );

    return {
        draggedEntity,
        currentDropVisual,
        currentDropTarget,
        lastDropResult,
        createDragProps,
    };
}
