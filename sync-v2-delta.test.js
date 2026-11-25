/* Tests d'intégration simulée de l'adaptateur delta — node sync-v2-delta.test.js */
"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync(__dirname + "/sync-v2-delta.js", "utf8");
const workspaceId = "ad49e922-7fd9-447d-b5df-0e5de2ce2554";

function createBackend() {
  const db = { records: [], events: [], devices: [], cursors: [], workspaces: [{ id: workspaceId, change_seq: 0, updated_at: "now" }] };
  function query(table) {
    const tableKey = ({ app_v2_records: "records", app_v2_change_log: "events", app_v2_devices: "devices", app_v2_sync_cursors: "cursors", app_v2_workspaces: "workspaces" })[table];
    let action = "select", values = null, filters = [], sort = null, max = Infinity, returning = false;
    const q = {
      select() { returning = true; return q; },
      eq(k, v) { filters.push(x => x[k] === v); return q; },
      gt(k, v) { filters.push(x => x[k] > v); return q; },
      order(k, opts) { sort = [k, opts && opts.ascending !== false]; return q; },
      limit(n) { max = n; return q; },
      insert(v) { action = "insert"; values = v; return q; },
      update(v) { action = "update"; values = v; return q; },
      upsert(v) { action = "upsert"; values = v; return q; },
      maybeSingle() { return execute(true); },
      single() { return execute(true); },
      then(resolve, reject) { return execute(false).then(resolve, reject); }
    };
    async function execute(single) {
      let rows = db[tableKey];
      const matches = x => filters.every(f => f(x));
      let data = null;
      if (action === "insert") {
        const input = Array.isArray(values) ? values : [values];
        const inserted = input.map(v => {
          if (table === "app_v2_records") {
            if (rows.some(x => x.workspace_id === v.workspace_id && x.entity_type === v.entity_type && x.record_id === v.record_id))
              return null;
            const row = { ...v, revision: 1, updated_at: new Date().toISOString() };
            rows.push(row); log(row, "upsert"); return row;
          }
          rows.push({ ...v }); return v;
        }).filter(Boolean);
        data = inserted;
      } else if (action === "upsert") {
        const input = Array.isArray(values) ? values : [values], output = [];
        for (const v of input) {
          const key = table === "app_v2_devices" ? x => x.id === v.id : x => x.workspace_id === v.workspace_id && x.device_id === v.device_id;
          const old = rows.find(key);
          if (old) Object.assign(old, v); else rows.push({ ...v });
          output.push(old || v);
        }
        data = output;
      } else if (action === "update") {
        const updated = [];
        for (const row of rows.filter(matches)) {
          if (table === "app_v2_records") {
            const next = { ...row, ...values, revision: row.revision + 1, updated_at: new Date().toISOString() };
            Object.assign(row, next); log(row, "upsert");
          } else Object.assign(row, values);
          updated.push(row);
        }
        data = updated;
      } else {
        data = rows.filter(matches);
        if (sort) data.sort((a,b) => (a[sort[0]] - b[sort[0]]) * (sort[1] ? 1 : -1));
        data = data.slice(0, max);
      }
      if (single) {
        const first = Array.isArray(data) ? data[0] || null : data;
        return { data: first, error: null };
      }
      return { data, error: null };
    }
    function log(row, operation) {
      const ws = db.workspaces.find(x => x.id === row.workspace_id);
      ws.change_seq += 1;
      db.events.push({ workspace_id: row.workspace_id, seq: ws.change_seq, entity_type: row.entity_type, record_id: row.record_id,
        operation, revision: row.revision, payload: { ...row.payload }, changed_at: row.updated_at });
    }
    return q;
  }
  return { db, from: query };
}

function makeDevice(backend, label) {
  const values = new Map();
  const localStorage = {
    getItem: k => values.has(k) ? values.get(k) : null,
    setItem: (k,v) => values.set(k, String(v))
  };
  const window = { crypto: { randomUUID: (() => { let n = 0; return () => label + "-device-" + (++n); })() },
    navigator: { userAgent: label }, localStorage };
  const context = { window, localStorage, navigator: window.navigator, Date, Math, Number, String, Set, Error, Object };
  vm.runInNewContext(source, context);
  return window.ChabanalV2DeltaSync.create(backend, { deviceLabel: label });
}

(async () => {
  const backend = createBackend();
  const phone1 = makeDevice(backend, "phone-1");
  const phone2 = makeDevice(backend, "phone-2");
  const received1 = [], received2 = [];

  // Création sur le téléphone 1, puis récupération sur le téléphone 2.
  const created = await phone1.save("client", "client-1", { name: "Client initial" }, null);
  assert.equal(created.revision, 1);
  const firstPull = await phone2.pullDelta(e => received2.push(e));
  assert.equal(firstPull.processed, 1);
  assert.equal(received2[0].record.name, "Client initial");

  // Modification sur le téléphone 2 ; le téléphone 1 récupère la révision 2.
  const updated = await phone2.save("client", "client-1", { name: "Client modifié" }, 1);
  assert.equal(updated.revision, 2);
  await phone1.pullDelta(e => received1.push(e));
  assert.equal(received1.at(-1).record.name, "Client modifié");

  // Écriture obsolète : le téléphone 1 ne doit pas écraser la révision 2.
  await assert.rejects(
    phone1.save("client", "client-1", { name: "Ancienne valeur" }, 1),
    /Conflit/
  );
  assert.equal(backend.db.records[0].payload.name, "Client modifié");

  // Suppression logique propagée comme événement upsert avec marqueur.
  const deleted = await phone2.remove("client", "client-1", { id: "client-1" }, 2);
  assert.equal(deleted.revision, 3);
  const deletionEvents = [];
  await phone1.pullDelta(e => deletionEvents.push(e));
  assert.equal(deletionEvents.at(-1).deleted, true);
  assert.equal(deletionEvents.at(-1).record.__deleted, true);

  // Un échec du gestionnaire ne doit pas faire avancer le curseur au-delà de l'événement.
  const phone3 = makeDevice(backend, "phone-3");
  await assert.rejects(phone3.pullDelta(async () => { throw new Error("consumer failed"); }), /consumer failed/);
  const replay = [];
  const resumed = await phone3.pullDelta(e => replay.push(e));
  assert.equal(resumed.processed, 3);
  assert.equal(replay.length, 3);
  assert.equal(replay.at(-1).deleted, true);

  // Reprise sans nouvel événement : aucun doublon.
  const empty = await phone3.pullDelta(e => replay.push(e));
  assert.equal(empty.processed, 0);
  assert.equal(replay.length, 3);

  console.log("OK — deux appareils simulés, création, delta, CAS anti-écrasement, suppression, reprise et curseur.");
})().catch(err => { console.error(err); process.exitCode = 1; });
