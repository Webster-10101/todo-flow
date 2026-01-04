"use client";

import type { Task } from "@/src/lib/types";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
import { TaskRow } from "./TaskRow";

function arrayMove<T>(arr: T[], from: number, to: number) {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function SortableSubtaskRow(props: {
  task: Task;
  index: number;
  onEditTitle: (id: string, title: string) => void;
  onEditMinutes: (id: string, minutes: number) => void;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate?: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative min-w-0">
      <div className="absolute left-1 top-2 flex">
        <button
          type="button"
          className="cursor-grab rounded-lg border border-line bg-white/70 px-2 py-1 text-[11px] text-muted hover:bg-soft transition-colors touch-none select-none"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder subtask"
        >
          ⋮⋮
        </button>
      </div>

      <div className="pl-8 sm:pl-10 min-w-0">
        <TaskRow
          task={props.task}
          compact
          onEditTitle={props.onEditTitle}
          onEditMinutes={props.onEditMinutes}
          onToggleDone={props.onToggleDone}
          onDelete={props.onDelete}
          onDuplicate={props.onDuplicate}
        />
      </div>
    </div>
  );
}

export function SubtaskList(props: {
  tasks: Task[];
  onReorder: (orderedIds: string[]) => void;
  onEditTitle: (id: string, title: string) => void;
  onEditMinutes: (id: string, minutes: number) => void;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate?: (id: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(e) => {
        const { active, over } = e;
        if (!over || active.id === over.id) return;
        const ids = props.tasks.map((t) => t.id);
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from === -1 || to === -1) return;
        props.onReorder(arrayMove(ids, from, to));
      }}
    >
      <SortableContext items={props.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {props.tasks.map((t, idx) => (
            <SortableSubtaskRow
              key={t.id}
              task={t}
              index={idx}
              onEditTitle={props.onEditTitle}
              onEditMinutes={props.onEditMinutes}
              onToggleDone={props.onToggleDone}
              onDelete={props.onDelete}
              onDuplicate={props.onDuplicate}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}


