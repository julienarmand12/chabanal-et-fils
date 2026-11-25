/* Chabanal et fils — réception V2 en zone tampon IndexedDB
 * Les événements sont isolés de la V1 : aucune clé métier n'est modifiée.
 */
(function (global) {
  "use strict";
  const DB_NAME = "chabanal_v2_inbound";
  const DB_VERSION = 1;
  const STORE = "events";
  const META = "meta";
  const MAX_EVENTS = 2000;
  const MAX_BYTES = 3 * 1024 * 1024;
  let busy = false, dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!global.indexedDB) { reject(new Error("IndexedDB indisponible sur cet appareil.")); return; }
      const request = global.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "seq" });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Ouverture de la zone tampon impossible."));
    });
    return dbPromise;
  }
  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Écriture IndexedDB impossible."));
      tx.onabort = () => reject(tx.error || new Error("Transaction IndexedDB annulée."));
    });
  }
  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Lecture IndexedDB impossible."));
    });
  }
  function safeEvent(event) {
    if (!event || !Number.isSafeInteger(Number(event.seq)) || !event.entity_type ||
        typeof event.record_id !== "string" || !event.record_id) {
      throw new Error("Événement V2 incomplet : réception interrompue.");
    }
    const payload = event.record;
    if (payload && JSON.stringify(payload).toLowerCase().includes("data_url")) {
      throw new Error("Un média contient encore une Data URL : réception suspendue sans avancer le curseur.");
    }
    if (event.entity_type === "media" && payload && !event.deleted &&
        !payload.deleted && !payload.__deleted && !payload.storage_path) {
      throw new Error("Référence Storage privée absente pour un média : réception suspendue.");
    }
    return {
      seq: Number(event.seq), entity_type: event.entity_type, record_id: event.record_id,
      operation: event.operation || (event.deleted ? "delete" : "upsert"),
      revision: Number(event.revision || 0), changed_at: event.changed_at || null,
      deleted: !!event.deleted, payload: payload || null
    };
  }
  async function stage(event) {
    const row = safeEvent(event);
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const existing = await requestValue(store.get(row.seq));
    if (existing) { await txDone(tx); return { duplicate: true }; }
    const all = await requestValue(store.getAll());
    if (all.length >= MAX_EVENTS) { tx.abort(); throw new Error("Zone tampon pleine (2 000 événements). Exportez les événements avant de continuer."); }
    const bytes = all.reduce((n, item) => n + JSON.stringify(item).length * 2, 0) + JSON.stringify(row).length * 2;
    if (bytes > MAX_BYTES) { tx.abort(); throw new Error("Zone tampon proche de la limite de sécurité (3 Mo). Aucun événement supplémentaire n'a été enregistré."); }
    store.put(row);
    await txDone(tx);
    return { duplicate: false };
  }
  async function allEvents() {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const rows = await requestValue(tx.objectStore(STORE).getAll());
    await txDone(tx);
    return rows.sort((a, b) => a.seq - b.seq);
  }
  async function getMeta() {
    const db = await openDb();
    const tx = db.transaction(META, "readonly");
    const row = await requestValue(tx.objectStore(META).get("lastPull"));
    await txDone(tx);
    return row && row.value || {};
  }
  async function setMeta(value) {
    const db = await openDb();
    const tx = db.transaction(META, "readwrite");
    tx.objectStore(META).put({ key: "lastPull", value });
    await txDone(tx);
  }
  async function pull() {
    if (busy) throw new Error("Une réception V2 est déjà en cours.");
    if (!global.ChabanalV2DeltaSync) throw new Error("Moteur delta V2 indisponible.");
    busy = true;
    try {
      if (typeof global.metierMediaSupabase !== "function") throw new Error("Accès Supabase authentifié indisponible.");
      const client = await global.metierMediaSupabase();
      if (!client) throw new Error("Connexion Supabase non authentifiée. Connectez-vous d’abord à la base métier.");
      const sync = global.ChabanalV2DeltaSync.create(client);
      const result = await sync.pullDelta(async event => { await stage(event); });
      await setMeta({ lastPullAt: new Date().toISOString(), cursor: result.cursor, processed: result.processed });
      return { ...result, staged: (await allEvents()).length };
    } finally { busy = false; }
  }
  async function status() {
    const events = await allEvents();
    return { count: events.length, meta: await getMeta() };
  }
  async function clearAfterExport() {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const count = await requestValue(store.count());
    if (!count) { await txDone(tx); return { cleared: 0 }; }
    if (!global.confirm("Supprimer les " + count + " événements de la zone tampon ? Cette action ne touche pas aux données V1.")) {
      tx.abort(); return { cancelled: true };
    }
    store.clear();
    await txDone(tx);
    return { cleared: count };
  }
  async function exportMergePlan() {
    if (!global.ChabanalV2MergePreview) throw new Error("Préparateur de fusion V2 indisponible.");
    const plan = global.ChabanalV2MergePreview.mapPlan(await allEvents(), global.localStorage);
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "chabanal-v2-plan-fusion-a-valider.json";
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    return plan;
  }
  async function exportJson() {
    const events = await allEvents();
    const data = JSON.stringify({ exported_at: new Date().toISOString(), events }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "chabanal-v2-evenements-a-integrer.json";
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    return events.length;
  }
  function mount() {
    const host = document.getElementById("v2LocalPreviewPanel");
    if (!host || document.getElementById("v2InboundStagingPanel")) return;
    const panel = document.createElement("div");
    panel.id = "v2InboundStagingPanel";
    panel.style.cssText = "margin-top:12px;padding:12px;border:1px solid #45617b;border-radius:10px";
    const title = document.createElement("strong");
    title.textContent = "Réception V2 — zone tampon sécurisée";
    const note = document.createElement("p");
    note.className = "muted small";
    note.textContent = "Les événements sont stockés dans IndexedDB, séparément des fiches V1. Aucune fiche n'est modifiée automatiquement.";
    const statusLine = document.createElement("p");
    statusLine.className = "muted small";
    const refresh = async () => {
      try {
        const s = await status();
        statusLine.textContent = s.count + " événement(s) en attente" +
          (s.meta.cursor ? " · curseur " + s.meta.cursor : "");
      } catch (error) { statusLine.textContent = "Zone tampon indisponible : " + error.message; }
    };
    const pullButton = document.createElement("button");
    pullButton.type = "button"; pullButton.className = "secondary small";
    pullButton.textContent = "Recevoir les événements V2 (sans fusion)";
    pullButton.addEventListener("click", async () => {
      pullButton.disabled = true; statusLine.textContent = "Réception en cours…";
      try {
        const result = await pull();
        statusLine.textContent = result.processed + " événement(s) lus · " + result.staged + " en attente dans la zone tampon.";
      } catch (error) { statusLine.textContent = "Réception suspendue : " + error.message; }
      finally { pullButton.disabled = false; await refresh(); }
    });
    const exportButton = document.createElement("button");
    exportButton.type = "button"; exportButton.className = "secondary small";
    exportButton.style.marginLeft = "8px"; exportButton.textContent = "Exporter la zone tampon";
    exportButton.addEventListener("click", async () => {
      try { const n = await exportJson(); statusLine.textContent = n + " événement(s) exporté(s) en JSON."; }
      catch (error) { statusLine.textContent = "Export impossible : " + error.message; }
    });
    const planButton = document.createElement("button");
    planButton.type = "button"; planButton.className = "secondary small";
    planButton.style.marginLeft = "8px"; planButton.textContent = "Préparer le plan de fusion (sans appliquer)";
    planButton.addEventListener("click", async () => {
      planButton.disabled = true;
      try {
        const plan = await exportMergePlan();
        const counts = Object.entries(plan.counts).map(([k,v]) => k + " : " + v).join(" · ");
        statusLine.textContent = "Plan exporté — " + (counts || "aucune opération") + " · aucune donnée V1 modifiée.";
      } catch (error) { statusLine.textContent = "Préparation impossible : " + error.message; }
      finally { planButton.disabled = false; }
    });
    const clearButton = document.createElement("button");
    clearButton.type = "button"; clearButton.className = "secondary small";
    clearButton.style.marginLeft = "8px"; clearButton.textContent = "Vider après export";
    clearButton.addEventListener("click", async () => {
      try { const r = await clearAfterExport(); statusLine.textContent = r.cancelled ? "Suppression annulée." : r.cleared + " événement(s) supprimé(s) de la zone tampon."; await refresh(); }
      catch (error) { statusLine.textContent = "Suppression impossible : " + error.message; }
    });
    panel.append(title, note, statusLine, pullButton, exportButton, planButton, clearButton);
    host.appendChild(panel); refresh();
  }
  global.ChabanalV2InboundStaging = Object.freeze({ pull, status, listEvents: allEvents, exportJson, clearAfterExport, mount });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else mount();
})(window);
