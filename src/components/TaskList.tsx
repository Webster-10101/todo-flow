"use client";

import type { Task } from "@/src/lib/types";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
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
import { TaskRow } from "./TaskRow";
import type { CSSProperties } from "react";

function arrayMove<T>(arr: T[], from: number, to: number) {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function SortableTaskRow(props: {
  task: Task;
  index: number;
  onEditTitle: (id: string, title: string) => void;
  onEditMinutes: (id: string, minutes: number) => void;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleInSprint?: (id: string) => void;
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
    <div ref={setNodeRef} style={style} className="relative">
      <div className="absolute left-2 top-3 flex">
        <button
          type="button"
          className="cursor-grab rounded-lg border border-line bg-white/70 px-2.5 py-2 text-xs text-muted hover:bg-soft transition-colors"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
        >
          ⋮⋮
        </button>
      </div>

      <div className="pl-10">
        <TaskRow
          task={props.task}
          onEditTitle={props.onEditTitle}
          onEditMinutes={props.onEditMinutes}
          onToggleDone={props.onToggleDone}
          onDelete={props.onDelete}
          onToggleInSprint={props.onToggleInSprint}
          tone={toneForIndex(props.index, props.task.kind)}
        />
      </div>
    </div>
  );
}

function toneForIndex(index: number, kind: Task["kind"]) {
  // Calm “stepping” inspired by gradient lists / OP-XY: subtle hue shifts per row.
  // Breaks lean greener to distinguish without shouting.
  const baseHue = kind === "break" ? 155 : 215;
  const hue = (baseHue + index * 10) % 360;
  return {
    accent: `hsl(${hue} 55% 42%)`,
    bg: `hsl(${hue} 45% 96%)`,
  };
}

export function TaskList(props: {
  tasks: Task[];
  onReorder: (orderedIds: string[]) => void;
  onEditTitle: (id: string, title: string) => void;
  onEditMinutes: (id: string, minutes: number) => void;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleInSprint?: (id: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const topLevel = props.tasks.filter((t) => t.parentId === null);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(e) => {
        const { active, over } = e;
        if (!over || active.id === over.id) return;
        const ids = topLevel.map((t) => t.id);
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from === -1 || to === -1) return;
        props.onReorder(arrayMove(ids, from, to));
      }}
    >
      <SortableContext
        items={topLevel.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-3">
          {topLevel.map((t, idx) => (
            <SortableTaskRow
              key={t.id}
              task={t}
              index={idx}
              onEditTitle={props.onEditTitle}
              onEditMinutes={props.onEditMinutes}
              onToggleDone={props.onToggleDone}
              onDelete={props.onDelete}
              onToggleInSprint={props.onToggleInSprint}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}


