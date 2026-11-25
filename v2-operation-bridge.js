/* Chabanal et fils — pont d'écriture V1 -> V2 (activation explicite)
 * Ne remplace pas la V1. N'effectue aucun pull et ne traite pas les médias.
 */
(function (global) {
  "use strict";
  const STATE_KEY = "chabanal_v2_operation_bridge_state";
  const FLAG_KEY = "chabanal_v2_operation_bridge_enabled";
  const WATCHED = new Set([
    "metier_clients_v1_2_corrigee", "metier_clients_deleted_v1",
    "metier_equipement_modeles_v1", "metier_equipement_attributions_v1",
    "metier_equipement_numeros_serie_v1", "metier_notifications_pieces_v1",
    "metier_diagnostics_marques_v1", "metier_heures_recuperation_v1",
    "chabanal_stock_cache_v1", "chabanal_stock_pending_v1"
  ]);
  let running = false, queued = false, timer = null, chain = Promise.resolve();

  function readState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{"records":{}}'); }
    catch (_) { return { records: {} }; }
  }
  function writeState(state) {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }
  function enabled() { return localStorage.getItem(FLAG_KEY) === "1"; }
  function mapper() {
    if (!global.ChabanalV2LegacyMapper) throw new Error("Mapper V2 indisponible.");
    const result = global.ChabanalV2LegacyMapper.mapSnapshot(localStorage);
    if (!result.ok) throw new Error(result.errors.join(" · "));
    const media = result.records.filter(row => row.entity_type === "media" ||
      JSON.stringify(row.payload).includes("data_url"));
    if (media.length) {
      throw new Error("Envoi suspendu : " + media.length +
        " média(s) nécessitent d'abord le transfert sécurisé vers le stockage privé Supabase.");
    }
    const brandsWithDocs = result.records.filter(row =>
      row.entity_type === "diagnostic_brand" &&
      Array.isArray(row.payload.documents) && row.payload.documents.length);
    if (brandsWithDocs.length) {
      throw new Error("Envoi suspendu : des documents de diagnostic doivent être extraits vers le stockage privé.");
    }
    return result.records;
  }
  function signature(value) { return JSON.stringify(value); }

  async function syncSnapshot() {
    if (running) { queued = true; return { skipped: true }; }
    if (!enabled()) throw new Error("Le pont V2 n'est pas activé sur cet appareil.");
    if (!global.ChabanalV2DeltaSync) throw new Error("Moteur delta V2 indisponible.");
    running = true;
    try {
      const records = mapper();
      if (typeof global.metierMediaSupabase !== "function") throw new Error("Accès Supabase authentifié indisponible. Aucun envoi effectué.");\n      const client = await global.metierMediaSupabase();\n      if (!client) throw new Error("Connexion Supabase non authentifiée. Aucun envoi effectué.");\n      const sync = global.ChabanalV2DeltaSync.create(client);
      const state = readState();
      const current = new Map(records.map(row => [row.entity_type + "::" + row.record_id, row]));
      let sent = 0, removed = 0;
      for (const [key, row] of current) {
        const old = state.records[key];
        const sig = signature(row.payload);
        if (old && old.signature === sig) continue;
        const saved = await sync.save(row.entity_type, row.record_id, row.payload,
          old ? Number(old.revision) : null);
        state.records[key] = { revision: Number(saved.revision), signature: sig };
        writeState(state);
        sent++;
      }
      for (const [key, old] of Object.entries(state.records)) {
        if (current.has(key)) continue;
        const parts = key.split("::");
        const type = parts.shift();
        const id = parts.join("::");
        await sync.remove(type, id, { id, source: "v1-local-delete" }, Number(old.revision));
        delete state.records[key];
        writeState(state);
        removed++;
      }
      return { sent, removed, total: records.length };
    } finally {
      running = false;
      if (queued) { queued = false; schedule(); }
    }
  }

  function schedule() {
    if (!enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      chain = chain.then(syncSnapshot).catch(error => {
        console.error("[Chabanal V2] Écriture différée non effectuée", error);
        const status = document.getElementById("v2BridgeStatus");
        if (status) status.textContent = "Envoi V2 suspendu : " + error.message;
      });
    }, 900);
  }

  function activate() {
    if (enabled()) return Promise.resolve({ enabled: true });
    const check = mapper();
    if (!confirm("Activer l'envoi V1 → V2 sur cet appareil ?\n\n" +
      check.length + " enregistrements métier seront envoyés vers le workspace V2. " +
      "Les médias sont exclus. Cette opération envoie des données professionnelles à Supabase. " +
      "La réception V2 → V1 n'est pas encore activée.")) return Promise.resolve({ cancelled: true });
    localStorage.setItem(FLAG_KEY, "1");
    return syncSnapshot().then(result => ({ enabled: true, result })).catch(error => {
      localStorage.removeItem(FLAG_KEY);
      throw error;
    });
  }

  function mount() {
    const host = document.getElementById("v2LocalPreviewPanel");
    if (!host || document.getElementById("v2OperationBridge")) return;
    const box = document.createElement("div");
    box.id = "v2OperationBridge";
    box.style.cssText = "margin-top:12px;padding:12px;border:1px solid #28547b;border-radius:10px";
    const title = document.createElement("strong");
    title.textContent = "Raccordement des enregistrements V1 → V2";
    const note = document.createElement("p");
    note.className = "muted small";
    note.textContent = "Envoi sortant uniquement, avec contrôle de révision. Aucun téléchargement vers la V1. Les médias bloquent l'envoi tant que leur stockage privé n'est pas prêt.";
    const status = document.createElement("p");
    status.id = "v2BridgeStatus";
    status.className = "muted small";
    status.textContent = enabled() ? "Pont activé sur cet appareil." : "Pont désactivé — aucune donnée envoyée.";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary small";
    button.textContent = enabled() ? "Envoyer les modifications V1 vers V2" : "Activer l'envoi V1 → V2";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const result = enabled() ? await syncSnapshot() : await activate();
        status.textContent = result.cancelled ? "Activation annulée." :
          "Envoi terminé : " + (result.result?.sent ?? result.sent ?? 0) +
          " enregistrement(s) envoyé(s), " + (result.result?.removed ?? result.removed ?? 0) +
          " suppression(s) propagée(s).";
        button.textContent = enabled() ? "Envoyer les modifications V1 vers V2" : "Activer l'envoi V1 → V2";
      } catch (error) {
        status.textContent = "Envoi non effectué : " + error.message;
      } finally { button.disabled = false; }
    });
    box.append(title, note, status, button);
    host.appendChild(box);
  }

  const nativeSet = Storage.prototype.setItem;
  const nativeRemove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (key, value) {
    const result = nativeSet.call(this, key, value);
    if (this === global.localStorage && WATCHED.has(String(key))) schedule();
    return result;
  };
  Storage.prototype.removeItem = function (key) {
    const result = nativeRemove.call(this, key);
    if (this === global.localStorage && WATCHED.has(String(key))) schedule();
    return result;
  };

  global.ChabanalV2OperationBridge = Object.freeze({
    enabled, syncSnapshot, activate, schedule
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else mount();
})(window);
