// Quest editor: the undo / redo stack. Plain logic, no DOM.
//
// A Command knows how to do and undo itself. Commands that carry a mergeKey
// fold into the previous entry while that entry is the newest and not sealed:
// dragging an entity runs hundreds of moves and leaves one undo step. seal()
// ends such a run (pointer up, a field's change event).

export interface Command {
  label: string;
  redo(): void;
  undo(): void;
  // Commands with the same key may merge. merge() gets the newer command (already
  // executed) and returns the command that stands for both, or null.
  mergeKey?: string;
  merge?(next: Command): Command | null;
}

export class History<C extends Command = Command> {
  private undoStack: C[] = [];
  private redoStack: C[] = [];
  private sealed = true;
  private cleanLength = 0; // undo stack length at the last save; -1 when the clean state was undone away
  readonly limit: number;

  constructor(limit = 500) {
    this.limit = limit;
  }

  // Executes `cmd` and records it.
  run(cmd: C): void {
    cmd.redo();
    const last = this.undoStack[this.undoStack.length - 1];
    const atClean = this.undoStack.length === this.cleanLength;
    if (last && !this.sealed && !atClean && cmd.mergeKey !== undefined && last.mergeKey === cmd.mergeKey && last.merge) {
      const merged = last.merge(cmd) as C | null;
      if (merged) {
        this.undoStack[this.undoStack.length - 1] = merged;
        this.redoStack.length = 0;
        return;
      }
    }
    if (this.redoStack.length && this.cleanLength > this.undoStack.length) this.cleanLength = -1; // redo history holding the clean state is dropped
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
    this.sealed = cmd.mergeKey === undefined;
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
      if (this.cleanLength > 0) this.cleanLength--;
      else if (this.cleanLength === 0) this.cleanLength = -1;
    }
  }

  // The next run() starts a new entry even if its key matches.
  seal(): void {
    this.sealed = true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }

  undo(): C | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.undo();
    this.redoStack.push(cmd);
    this.sealed = true;
    return cmd;
  }

  redo(): C | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.redo();
    this.undoStack.push(cmd);
    this.sealed = true;
    return cmd;
  }

  // The current state is the saved one.
  markClean(): void {
    this.cleanLength = this.undoStack.length;
    this.sealed = true;
  }

  get dirty(): boolean {
    return this.cleanLength !== this.undoStack.length;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.cleanLength = 0;
    this.sealed = true;
  }

  get size(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }
}
