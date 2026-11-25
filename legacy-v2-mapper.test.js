/* Tests locaux du mapper — exécuter avec : node legacy-v2-mapper.test.js */
"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const context = { window: {}, encodeURIComponent, JSON, Set, Map, Object, Array, String, Number, Error };
vm.runInNewContext(fs.readFileSync(__dirname + "/legacy-v2-mapper.js", "utf8"), context);
const mapper = context.window.ChabanalV2LegacyMapper;
assert.ok(mapper, "Le mapper doit être exposé");

function storage(values) {
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? JSON.stringify(values[key]) : null;
    }
  };
}
const K = mapper.keys;
const good = storage({
  [K.clients]: [{ id: "c1", name: "Client", interventions: [{ date: "01/01/2026", description: "Entretien" }] }],
  [K.models]: [{ id: "m1", name: "Chaudière", documents: [{ name: "notice.pdf", type: "application/pdf", data: "data:application/pdf;base64,AA==" }] }],
  [K.assignments]: { c1: ["m1"] },
  [K.serials]: { c1: { m1: "SER123", "__year__m1": "2020" } },
  [K.notifications]: { n1: { id: "n1", status: "new" } },
  [K.diagnostics]: [{ id: "d1", name: "Marque", documents: ["data:application/pdf;base64,AA=="] }],
  [K.recovery]: { dayMinutes: 420, entries: [{ id: "h1", minutes: 30 }] },
  [K.stockCache]: { "metier_stock_v1_brand_b1": { value: { id: "b1", kind: "brand", name: "Marque" }, version: 1 } },
  [K.stockPending]: { "metier_stock_v1_item_i1": { value: { id: "i1", kind: "item", brandId: "b1", quantity: 2 }, baseVersion: 0 } },
  [K.mediaPending]: { "metier_media_v1_client_c1__f1": { id: "f1", scope: "client", ownerId: "c1", kind: "photo", name: "photo.jpg", mime: "image/jpeg", data: "data:image/jpeg;base64,AA==" } }
});
const result = mapper.mapSnapshot(good);
assert.equal(result.ok, true, result.errors.join("; "));
const count = type => result.records.filter(x => x.entity_type === type).length;
assert.equal(count("client"), 1);
assert.equal(count("intervention"), 1);
assert.equal(count("equipment_installation"), 1);
assert.equal(count("equipment_serial"), 2);
assert.equal(count("media"), 2);
assert.equal(result.records.find(x => x.entity_type === "equipment_serial").payload.year, "2020");
assert.equal(count("stock_item"), 2);
assert.equal(count("recovery_time"), 1);

const duplicate = mapper.mapSnapshot(storage({
  [K.clients]: [{ id: "dup", name: "A" }, { id: "dup", name: "B" }]
}));
assert.equal(duplicate.ok, false, "Un doublon client doit bloquer la migration");
assert.ok(duplicate.errors.some(x => x.includes("Identifiant client en double")));

const deleted = mapper.mapSnapshot(storage({
  [K.clients]: [{ id: "gone", name: "Supprimé" }],
  [K.deletedClients]: ["gone"]
}));
assert.equal(deleted.ok, true);
assert.equal(deleted.records.some(x => x.entity_type === "client" && x.record_id === "gone"), false);
assert.equal(deleted.records.some(x => x.entity_type === "deletion_marker" && x.record_id === "gone"), true);

console.log("OK — mapping clients/interventions/équipements/séries/médias/stock/heures, doublons et suppressions.");
