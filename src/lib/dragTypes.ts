// Drag payloads shared between the goals column and the day canvas.
//
// One drag carries two payloads. The goals column reads the things_id (re-file
// under another goal); the canvas reads title + minutes (schedule it, or drop
// it into an existing block as a subtask). Custom MIME types mean neither drop
// target can be triggered by a stray text drag from somewhere else.

export const GOAL_DRAG_MIME = "application/x-todoflow-things-id";
export const TODO_DRAG_MIME = "application/x-todoflow-todo";

export type DraggedTodo = { title: string; minutes: number };

export function readDraggedTodo(dt: DataTransfer): DraggedTodo | null {
  const raw = dt.getData(TODO_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DraggedTodo>;
    if (typeof parsed?.title !== "string") return null;
    const minutes =
      typeof parsed.minutes === "number" && Number.isFinite(parsed.minutes)
        ? Math.max(1, Math.round(parsed.minutes))
        : null;
    return minutes ? { title: parsed.title, minutes } : null;
  } catch {
    return null;
  }
}

export function hasDraggedTodo(dt: DataTransfer): boolean {
  return Array.from(dt.types).includes(TODO_DRAG_MIME);
}

// The todo currently under the cursor mid-drag. HTML5 forbids reading
// dataTransfer contents during dragover (only the type list is exposed), so
// the canvas ghost would have no title and no length to preview. Both ends of
// the drag live in this document, so a module-scope handoff is enough.
let inFlight: DraggedTodo | null = null;

export function setDraggedTodo(todo: DraggedTodo | null): void {
  inFlight = todo;
}

export function peekDraggedTodo(): DraggedTodo | null {
  return inFlight;
}
