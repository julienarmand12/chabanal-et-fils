/* Tests locaux du transfert média V2 — stockage entièrement simulé.
 * Exécution : node --test tests/v2-media-transfer.test.cjs
 * Aucun réseau, Supabase, fichier utilisateur ou accès à localStorage.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "v2-media-transfer.js"), "utf8");
const sandbox = {
  window: {
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    crypto: crypto.webcrypto,
    document: { readyState: "loading", addEventListener() {} }
  },
  Uint8Array, Blob, URL, setTimeout, console
};
vm.runInNewContext(source, sandbox, { filename: "v2-media-transfer.js" });
const engine = sandbox.window.ChabanalV2MediaTransfer;

function dataUrl(bytes, mime = "image/png") {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}
async function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// Faux Storage en mémoire : create refuse tout écrasement, download relit les octets.
function fakeStorage() {
  const objects = new Map();
  return {
    objects,
    async upload(path, bytes, options = {}) {
      if (options.upsert !== false) throw new Error("Le test exige upsert:false");
      if (objects.has(path)) throw new Error("Object already exists");
      objects.set(path, Buffer.from(bytes));
    },
    async download(path) {
      if (!objects.has(path)) throw new Error("Object not found");
      return Buffer.from(objects.get(path));
    }
  };
}

test("prépare un manifeste avec empreinte SHA-256 réelle, sans écrire", async () => {
  const bytes = Buffer.from("fichier fictif Chabanal V2");
  const plan = await engine.prepare([{
    id: "synthetic-01", scope: "client", owner_id: "client-test",
    name: "test.png", data_url: dataUrl(bytes)
  }], "workspace-synthetic");
  assert.equal(plan.prepared, 1);
  assert.equal(plan.rejected, 0);
  assert.equal(plan.writes_performed, false);
  assert.equal(plan.uploads_performed, false);
  assert.equal(plan.items[0].sha256, await sha256(bytes));
  assert.equal(plan.items[0].storage_path, "workspace-synthetic/client/client-test/synthetic-01.png");
  assert.equal(plan.items[0].binary_bytes, bytes.length);
});

test("rejette MIME interdit et Data URL invalide", async () => {
  const plan = await engine.prepare([
    { id: "bad-mime", data_url: dataUrl("x", "text/html") },
    { id: "bad-url", data_url: "not-a-data-url" }
  ], "workspace-synthetic");
  assert.equal(plan.prepared, 0);
  assert.equal(plan.rejected, 2);
});

test("copie vers le faux Storage puis vérifie les octets et le SHA-256", async () => {
  const bytes = Buffer.from("contenu synthétique à transférer");
  const plan = await engine.prepare([{
    id: "synthetic-copy", scope: "client", owner_id: "owner-test",
    data_url: dataUrl(bytes)
  }], "workspace-synthetic");
  const item = plan.items[0];
  const storage = fakeStorage();
  await storage.upload(item.storage_path, bytes, { upsert: false });
  const downloaded = await storage.download(item.storage_path);
  assert.deepEqual(downloaded, bytes);
  assert.equal(await sha256(downloaded), item.sha256);
});

test("refuse l'écrasement d'un objet déjà présent", async () => {
  const storage = fakeStorage();
  await storage.upload("synthetic/existing.png", Buffer.from("original"), { upsert: false });
  await assert.rejects(
    storage.upload("synthetic/existing.png", Buffer.from("replacement"), { upsert: false }),
    /already exists/
  );
  assert.equal((await storage.download("synthetic/existing.png")).toString(), "original");
});

test("le transfert réel reste bloqué", async () => {
  assert.equal(engine.realTransferEnabled(), false);
  await assert.rejects(engine.execute(), /désactivé/);
});
