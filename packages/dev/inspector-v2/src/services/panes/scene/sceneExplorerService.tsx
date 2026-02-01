import type { IDisposable } from "core/index";

import type { EntityBase, SceneExplorerCommandProvider, SceneExplorerSection } from "../../../components/scene/sceneExplorer";
import type { DropPosition, SceneExplorerDropEvent } from "../../../components/scene/sceneExplorerDragDrop";
import type { IService, ServiceDefinition } from "../../../modularity/serviceDefinition";
import type { ISceneContext } from "../../sceneContext";
import type { ISelectionService } from "../../selectionService";
import type { IShellService } from "../../shellService";

import { CubeTreeRegular } from "@fluentui/react-icons";
import { Observable } from "core/Misc/observable";

import { SceneExplorer } from "../../../components/scene/sceneExplorer";
import { useObservableState, useOrderedObservableCollection } from "../../../hooks/observableHooks";
import { ObservableCollection } from "../../../misc/observableCollection";
import { SceneContextIdentity } from "../../sceneContext";
import { SelectionServiceIdentity } from "../../selectionService";
import { ShellServiceIdentity } from "../../shellService";

export const SceneExplorerServiceIdentity = Symbol("SceneExplorer");

/**
 * Allows new sections or commands to be added to the scene explorer pane.
 */
export interface ISceneExplorerService extends IService<typeof SceneExplorerServiceIdentity> {
    /**
     * Adds a new section (e.g. "Nodes", "Materials", etc.) (this includes all descendants within the scene graph).
     * @param section A description of the section to add.
     */
    addSection<T>(section: SceneExplorerSection<T>): IDisposable;

    /**
     * Adds a new command (e.g. "Delete", "Rename", etc.) that can be executed on entities in the scene explorer.
     * @param command A description of the command to add.
     */
    addEntityCommand<T>(command: SceneExplorerCommandProvider<T>): IDisposable;

    /**
     * Adds a new command that can be executed on sections in the scene explorer.
     * @param command A description of the command to add.
     */
    addSectionCommand<T extends string>(command: SceneExplorerCommandProvider<T, "contextMenu">): IDisposable;

    /**
     * Enables or disables drag-to-reparent functionality for Node entities in the scene explorer.
     * When enabled, users can drag nodes and drop them onto other nodes to change the parent-child relationship.
     */
    enableDragToReparent: boolean;

    /**
     * Callback invoked when a drag-drop operation occurs.
     * Consumers can use this to intercept or customize the drop behavior.
     * Call `event.preventDefault()` to cancel the default reparenting behavior.
     */
    onDrop: ((event: SceneExplorerDropEvent) => void) | undefined;

    /**
     * Optional callback to determine if a node can be dragged.
     * Return false to prevent dragging a specific node.
     * If not set, all nodes are draggable.
     */
    canDrag: ((entity: EntityBase) => boolean) | undefined;

    /**
     * Optional callback to determine if a drop operation is valid.
     * Return false to prevent dropping the dragged entity onto the target at the given position.
     * Built-in cycle detection is always applied; this callback adds additional validation.
     * If not set, all drops that pass cycle detection are allowed.
     */
    canDrop: ((draggedEntity: EntityBase, targetEntity: EntityBase, dropPosition: DropPosition) => boolean) | undefined;
}

/**
 * Provides a scene explorer pane that enables browsing the scene graph and executing commands on entities.
 */
export const SceneExplorerServiceDefinition: ServiceDefinition<[ISceneExplorerService], [ISceneContext, IShellService, ISelectionService]> = {
    friendlyName: "Scene Explorer",
    produces: [SceneExplorerServiceIdentity],
    consumes: [SceneContextIdentity, ShellServiceIdentity, SelectionServiceIdentity],
    factory: (sceneContext, shellService, selectionService) => {
        const sectionsCollection = new ObservableCollection<SceneExplorerSection<unknown>>();
        const entityCommandsCollection = new ObservableCollection<SceneExplorerCommandProvider<unknown>>();
        const sectionCommandsCollection = new ObservableCollection<SceneExplorerCommandProvider<string, "contextMenu">>();

        let dragToReparentEnabled = true;
        const dragToReparentObservable = new Observable<void>();

        let onDropCallback: ((event: SceneExplorerDropEvent) => void) | undefined = undefined;
        let canDragCallback: ((entity: EntityBase) => boolean) | undefined = undefined;
        let canDropCallback: ((draggedEntity: EntityBase, targetEntity: EntityBase, dropPosition: DropPosition) => boolean) | undefined = undefined;

        const registration = shellService.addSidePane({
            key: "Scene Explorer",
            title: "Scene Explorer",
            icon: CubeTreeRegular,
            horizontalLocation: "left",
            verticalLocation: "top",
            suppressTeachingMoment: true,
            content: () => {
                const sections = useOrderedObservableCollection(sectionsCollection);
                const entityCommands = useOrderedObservableCollection(entityCommandsCollection);
                const sectionCommands = useOrderedObservableCollection(sectionCommandsCollection);
                const scene = useObservableState(() => sceneContext.currentScene, sceneContext.currentSceneObservable);
                const entity = useObservableState(() => selectionService.selectedEntity, selectionService.onSelectedEntityChanged);
                const enableDragToReparent = useObservableState(() => dragToReparentEnabled, dragToReparentObservable);

                return (
                    <>
                        {scene && (
                            <SceneExplorer
                                sections={sections}
                                entityCommandProviders={entityCommands}
                                sectionCommandProviders={sectionCommands}
                                scene={scene}
                                selectedEntity={entity}
                                setSelectedEntity={(entity) => (selectionService.selectedEntity = entity)}
                                enableDragToReparent={enableDragToReparent}
                                onDrop={onDropCallback}
                                canDrag={canDragCallback}
                                canDrop={canDropCallback}
                            />
                        )}
                    </>
                );
            },
        });

        return {
            addSection: (section) => sectionsCollection.add(section as SceneExplorerSection<unknown>),
            addEntityCommand: (command) => entityCommandsCollection.add(command as SceneExplorerCommandProvider<unknown>),
            addSectionCommand: (command) => sectionCommandsCollection.add(command as unknown as SceneExplorerCommandProvider<string, "contextMenu">),
            get enableDragToReparent() {
                return dragToReparentEnabled;
            },
            set enableDragToReparent(value: boolean) {
                if (dragToReparentEnabled !== value) {
                    dragToReparentEnabled = value;
                    dragToReparentObservable.notifyObservers();
                }
            },
            get onDrop() {
                return onDropCallback;
            },
            set onDrop(value: ((event: SceneExplorerDropEvent) => void) | undefined) {
                onDropCallback = value;
            },
            get canDrag() {
                return canDragCallback;
            },
            set canDrag(value: ((entity: EntityBase) => boolean) | undefined) {
                canDragCallback = value;
            },
            get canDrop() {
                return canDropCallback;
            },
            set canDrop(value: ((draggedEntity: EntityBase, targetEntity: EntityBase, dropPosition: DropPosition) => boolean) | undefined) {
                canDropCallback = value;
            },
            dispose: () => {
                dragToReparentObservable.clear();
                registration.dispose();
            },
        };
    },
};
