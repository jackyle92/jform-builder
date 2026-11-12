import { FormStore, keyFromLabel, allKeys, clone } from "c/jformStore";

const def = () => ({
  id: "a00",
  name: "Test",
  sections: [{ key: "p1", name: "Page 1", fields: [{ key: "first", type: "text", label: "First" }] }]
});

describe("FormStore", () => {
  it("commits with undo and redo", () => {
    const store = new FormStore(def());
    expect(store.dirty).toBe(false);
    store.commit((d) => {
      d.sections[0].fields[0].label = "Given name";
    });
    expect(store.state.sections[0].fields[0].label).toBe("Given name");
    expect(store.dirty).toBe(true);
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(store.state.sections[0].fields[0].label).toBe("First");
    expect(store.dirty).toBe(false);
    expect(store.canRedo).toBe(true);
    store.redo();
    expect(store.state.sections[0].fields[0].label).toBe("Given name");
  });

  it("does not mutate previous states", () => {
    const store = new FormStore(def());
    const before = store.state;
    store.commit((d) => d.sections[0].fields.push({ key: "x", type: "text", label: "X" }));
    expect(before.sections[0].fields).toHaveLength(1);
    expect(store.state.sections[0].fields).toHaveLength(2);
  });

  it("skips commits that return false", () => {
    const store = new FormStore(def());
    store.commit(() => false);
    expect(store.canUndo).toBe(false);
  });

  it("markSaved adopts ids and clears dirty when nothing changed meanwhile", () => {
    const store = new FormStore(def());
    store.commit((d) => d.sections[0].fields.push({ key: "email", type: "email", label: "Email", options: undefined }));
    const saved = JSON.parse(JSON.stringify(store.state));
    saved.sections[0].fields[1].id = "a01NEW";
    store.markSaved(saved);
    expect(store.state.sections[0].fields[1].id).toBe("a01NEW");
    expect(store.dirty).toBe(false);
  });

  it("markSaved adopts what the server normalised when nothing changed since the save was sent", () => {
    const store = new FormStore({ ...def(), targetObjectApiName: "lead" });
    store.commit((d) => (d.name = "Renamed"));
    const sent = store.state;
    const saved = { ...JSON.parse(JSON.stringify(sent)), targetObjectApiName: "Lead" };
    store.markSaved(saved, sent);
    expect(store.state.targetObjectApiName).toBe("Lead");
    expect(store.dirty).toBe(false);
  });

  it("markSaved with the sent state keeps edits made during the save and stays dirty", () => {
    const store = new FormStore(def());
    store.commit((d) => (d.name = "Renamed"));
    const sent = store.state;
    const saved = { ...JSON.parse(JSON.stringify(sent)), id: "a00NEW" };
    store.commit((d) => (d.name = "Renamed again"));
    store.markSaved(saved, sent);
    expect(store.state.name).toBe("Renamed again");
    expect(store.state.id).toBe("a00NEW");
    expect(store.dirty).toBe(true);
  });

  it("markSaved keeps in-flight edits dirty", () => {
    const store = new FormStore(def());
    store.commit((d) => (d.name = "Renamed"));
    const saved = JSON.parse(JSON.stringify(store.state));
    store.commit((d) => (d.name = "Renamed again"));
    store.markSaved(saved);
    expect(store.state.name).toBe("Renamed again");
    expect(store.dirty).toBe(true);
  });

  it("notifies subscribers and allows unsubscribe", () => {
    const store = new FormStore(def());
    const seen = [];
    const off = store.subscribe((s, reason) => seen.push(reason));
    store.commit((d) => (d.name = "A"));
    store.undo();
    off();
    store.redo();
    expect(seen).toEqual(["edit", "undo"]);
  });
});

describe("keys", () => {
  it("derives unique keys from labels", () => {
    const existing = new Set(["first_name"]);
    expect(keyFromLabel("First name", existing)).toBe("first_name_2");
    expect(keyFromLabel("Email address!", existing)).toBe("email_address");
    expect(keyFromLabel("123", existing)).toBe("field_123");
    expect(keyFromLabel("", existing)).toBe("field");
  });
  it("collects all keys", () => {
    expect([...allKeys(def())]).toEqual(["p1", "first"]);
  });
});

describe("FormStore revisions", () => {
  it("adopts the server's revision even when the user kept typing during the save", () => {
    const store = new FormStore({ ...def(), revision: 4 });
    store.commit((d) => {
      d.name = "Renamed";
    });
    const sent = store.state;
    store.commit((d) => {
      d.description = "typed while saving";
    });
    store.markSaved({ ...sent, revision: 5, sections: sent.sections.map((s) => ({ ...s, id: "sec1" })) }, sent);
    expect(store.state.description).toBe("typed while saving"); // the in-flight edit survives
    expect(store.state.revision).toBe(5); // but the counter moves on
    expect(store.state.sections[0].id).toBe("sec1");
    expect(store.dirty).toBe(true);
  });

  /** A save the server took: it returns what was sent with the next revision. */
  const save = (store) => {
    const sent = store.state;
    store.markSaved({ ...clone(sent), revision: sent.revision + 1 }, sent);
  };

  it("undo and redo after a save keep the saved revision, without changing history", () => {
    const store = new FormStore({ ...def(), revision: 4 });
    const loaded = store.state;
    store.commit((d) => (d.name = "Renamed"));
    save(store);
    store.undo();
    expect(store.state.name).toBe("Test");
    expect(store.state.revision).toBe(5); // the server is at 5: the restored state was loaded at 4
    expect(loaded.revision).toBe(4);
    expect(store.dirty).toBe(true);
    save(store);
    store.redo();
    expect(store.state.name).toBe("Renamed");
    expect(store.state.revision).toBe(6);
    save(store);
    store.undo();
    expect(store.state.name).toBe("Test");
    expect(store.state.revision).toBe(7);
  });

  it("returns the same state when nothing about the record changed", () => {
    const store = new FormStore({ ...def(), revision: 4 });
    const loaded = store.state;
    store.commit((d) => (d.name = "Renamed"));
    store.undo();
    expect(store.state).toBe(loaded);
    expect(store.dirty).toBe(false);
  });

  it("keeps the record fields of a publish when undoing past it", () => {
    const store = new FormStore({ ...def(), revision: 4, status: "Draft", isActive: false });
    store.commit((d) => (d.name = "Published name"));
    save(store);
    // the workspace's publish: the same edits, record fields and revision from the server
    store.replace({ ...store.state, status: "Active", isActive: true, version: 1, publicKey: "k1", revision: 6, publishedRevision: 6 }, { markSaved: true });
    store.commit((d) => (d.name = "After publishing"));
    store.undo();
    store.undo();
    expect(store.state.name).toBe("Test");
    expect(store.state).toMatchObject({ status: "Active", isActive: true, version: 1, publicKey: "k1", publishedRevision: 6, revision: 6 });
  });

  it("keeps the old revision on states from before a change made elsewhere, so saving one is refused", () => {
    const store = new FormStore({ ...def(), revision: 4 });
    store.commit((d) => (d.name = "Mine"));
    save(store);
    // a clean tab reloads the server's copy after another tab or Agentforce saved it
    store.replace({ ...store.state, name: "Agent's", revision: 6 }, { markSaved: true });
    store.commit((d) => (d.name = "Mine again"));
    save(store);
    store.undo();
    expect(store.state.name).toBe("Agent's");
    expect(store.state.revision).toBe(7); // after the reload: this tab's own run
    store.undo();
    expect(store.state.name).toBe("Test");
    expect(store.state.revision).toBe(4); // stale: the save conflicts instead of undoing the agent's edit
    store.redo();
    expect(store.state.revision).toBe(7);
  });

  it("follows Keep mine: the overwritten revision becomes this tab's", () => {
    const store = new FormStore({ ...def(), revision: 4 });
    store.commit((d) => (d.name = "Mine"));
    store.replace({ ...store.state, revision: 9 }, { markSaved: false }); // Keep mine adopts the newer revision
    save(store);
    store.undo();
    expect(store.state.name).toBe("Test");
    expect(store.state.revision).toBe(10);
  });

  it("an undo during a save takes the new revision when the save returns", () => {
    const store = new FormStore({ ...def(), revision: 4 });
    store.commit((d) => (d.name = "Renamed"));
    const sent = store.state;
    store.undo();
    store.markSaved({ ...clone(sent), revision: 5 }, sent);
    expect(store.state.name).toBe("Test");
    expect(store.state.revision).toBe(5);
    store.redo();
    expect(store.state.revision).toBe(5);
  });
});
