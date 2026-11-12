/**
 * Immutable form state with undo, redo and dirty tracking for the workspace.
 * Pure JavaScript so it is unit tested with Jest.
 */

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function allKeys(definition) {
  const keys = new Set();
  for (const s of definition?.sections || []) {
    if (s.key) keys.add(s.key);
    for (const f of s.fields || []) if (f.key) keys.add(f.key);
  }
  return keys;
}

/** Make a readable, unique key from a label, e.g. "First name" -> first_name. */
export function keyFromLabel(label, existing, fallback = "field") {
  let base = String(label || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  if (!base || !/^[a-z]/.test(base)) base = `${fallback}_${base}`.replace(/_+$/, "");
  let key = base;
  let n = 2;
  while (existing.has(key)) key = `${base}_${n++}`;
  return key;
}

const HISTORY_LIMIT = 50;
// set by the server, not by editing: undo and redo leave them as they are now
const RECORD_FIELDS = ["id", "version", "status", "isActive", "publicKey", "publishedRevision"];

const revisionOf = (def) => def?.revision ?? null;

export class FormStore {
  constructor(definition) {
    this.present = clone(definition) || null;
    this.past = [];
    this.future = [];
    this.savedSnapshot = JSON.stringify(this.present);
    // The server revisions this tab's own edits went through, latest last: the one it loaded, then
    // each save and publish. A state from history at one of them is saved at the latest.
    this.ownRevisions = [revisionOf(this.present)];
    this.listeners = new Set();
  }

  get state() {
    return this.present;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get dirty() {
    return JSON.stringify(this.present) !== this.savedSnapshot;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(reason) {
    for (const l of this.listeners) l(this.present, reason);
  }

  /** Replace the whole definition (after load or save). Clears history when `resetHistory`. */
  replace(definition, { markSaved = false, resetHistory = false } = {}) {
    const before = this.present;
    this.present = clone(definition);
    if (resetHistory) {
      this.past = [];
      this.future = [];
    }
    if (markSaved) {
      this.savedSnapshot = JSON.stringify(this.present);
      // The server's copy. With other edits it was changed elsewhere: states from before it keep their
      // revision, so saving one is refused instead of written over that change. With the same edits
      // (a publish) this tab's run goes on.
      if (edits(before) === edits(this.present)) this.advanceRevision(revisionOf(before), revisionOf(this.present));
      else this.ownRevisions = [revisionOf(this.present)];
    }
    this.notify("replace");
  }

  /** Apply a mutation to a copy of the state and record it for undo. */
  commit(mutator, reason = "edit") {
    const next = clone(this.present);
    const result = mutator(next);
    if (result === false) return; // mutator declined
    this.past.push(this.present);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.present = next;
    this.notify(reason);
  }

  undo() {
    if (!this.canUndo) return;
    this.future.push(this.present);
    this.present = this.restore(this.past.pop());
    this.notify("undo");
  }

  redo() {
    if (!this.canRedo) return;
    this.past.push(this.present);
    this.present = this.restore(this.future.pop());
    this.notify("redo");
  }

  /**
   * A state from history, brought up to date with the record: undo takes back edits, not a save or a
   * publish. It takes the current record fields, and the latest revision when it is from this tab's own
   * run of saves. Record ids stay as they were: the server matches pages and fields by key, and options
   * by value, when an id is missing or deleted. A changed state is a copy; history is never mutated.
   */
  restore(state) {
    if (!state) return state;
    const now = {};
    for (const k of RECORD_FIELDS) if (state[k] !== this.present?.[k]) now[k] = this.present?.[k];
    const latest = this.ownRevisions[this.ownRevisions.length - 1];
    if (revisionOf(state) !== latest && this.ownRevisions.includes(revisionOf(state))) now.revision = latest;
    return Object.keys(now).length ? Object.assign(clone(state), now) : state;
  }

  /** The server went from one revision to the next with this tab's edits: a save, a publish, or Keep mine's overwrite. */
  advanceRevision(from, to) {
    if (to === undefined || to === null) return;
    for (const r of [from, to]) if (!this.ownRevisions.includes(r)) this.ownRevisions.push(r);
  }

  /**
   * Record that the current state is persisted. When the server returns the
   * saved definition (with new record Ids, and anything it normalised), adopt it
   * outright if nothing changed while the save was in flight; otherwise keep the
   * user's edits and only take the ids. `sentState` is the state object that was
   * sent: state is immutable, so identity tells exactly whether edits happened.
   */
  markSaved(savedDefinition, sentState) {
    if (savedDefinition) {
      this.advanceRevision(revisionOf(sentState === undefined ? this.present : sentState), savedDefinition.revision);
      const unchanged = sentState === undefined ? JSON.stringify(stripIds(this.present)) === JSON.stringify(stripIds(savedDefinition)) : this.present === sentState;
      if (unchanged) {
        this.present = clone(savedDefinition);
        this.savedSnapshot = JSON.stringify(this.present);
      } else {
        adoptIds(this.present, savedDefinition);
        this.savedSnapshot = JSON.stringify(savedDefinition);
      }
    } else {
      this.savedSnapshot = JSON.stringify(this.present);
    }
    this.notify("saved");
  }
}

/** Copy record ids from a saved definition onto the live one by key. */
function adoptIds(live, saved) {
  if (!live || !saved) return;
  live.id = saved.id ?? live.id;
  // the server's save counter: without it the next save would be refused as stale
  if (saved.revision !== undefined) live.revision = saved.revision;
  const savedSections = new Map((saved.sections || []).map((s) => [s.key, s]));
  for (const s of live.sections || []) {
    const ss = savedSections.get(s.key);
    if (!ss) continue;
    s.id = ss.id;
    const savedFields = new Map((ss.fields || []).map((f) => [f.key, f]));
    for (const f of s.fields || []) {
      const sf = savedFields.get(f.key);
      if (!sf) continue;
      f.id = sf.id;
      if (Array.isArray(f.options) && Array.isArray(sf.options)) {
        const byValue = new Map(sf.options.map((o) => [o.value ?? o.label, o]));
        for (const o of f.options) {
          const so = byValue.get(o.value ?? o.label);
          if (so) o.id = so.id;
        }
      }
    }
  }
}

/** What the user edited: the definition without its record fields, ids, order or revision. */
function edits(def) {
  const d = stripIds(def);
  if (d) delete d.revision;
  return JSON.stringify(d);
}

function stripIds(def) {
  const d = clone(def);
  if (!d) return d;
  for (const k of RECORD_FIELDS) delete d[k];
  for (const s of d.sections || []) {
    delete s.id;
    delete s.order;
    for (const f of s.fields || []) {
      delete f.id;
      delete f.order;
      for (const o of f.options || []) {
        delete o.id;
        delete o.order;
      }
    }
  }
  return d;
}
