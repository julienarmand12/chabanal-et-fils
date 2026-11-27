/* Chabanal et fils — mapping local legacy -> app_v2_records
 * Lecture seule : construit un instantané normalisé en mémoire.
 * Aucun accès réseau, aucune écriture localStorage, aucun transfert Supabase.
 */
(function (global) {
  "use strict";

  const KEYS = Object.freeze({
    clients: "metier_clients_v1_2_corrigee",
    deletedClients: "metier_clients_deleted_v1",
    models: "metier_equipement_modeles_v1",
    assignments: "metier_equipement_attributions_v1",
    serials: "metier_equipement_numeros_serie_v1",
    notifications: "metier_notifications_pieces_v1",
    diagnostics: "metier_diagnostics_marques_v1",
    recovery: "metier_heures_recuperation_v1",
    stockCache: "chabanal_stock_cache_v1",
    stockPending: "chabanal_stock_pending_v1",
    mediaPending: "chabanal_media_pending_v1"
  });

  const ALLOWED = new Set([
    "client", "intervention", "equipment_model", "equipment_installation",
    "equipment_serial", "media", "stock_item", "notification",
    "diagnostic_brand", "recovery_time", "deletion_marker"
  ]);

  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      const out = {};
      Object.keys(value).sort().forEach(k => { out[k] = stable(value[k]); });
      return out;
    }
    return value;
  }
  function json(value) { return JSON.stringify(stable(value)); }
  function read(storage, key, fallback) {
    const raw = storage.getItem(key);
    if (raw == null) return fallback;
    try { return JSON.parse(raw); }
    catch (_) { throw new Error("JSON local illisible pour la clé " + key); }
  }
  function idPart(value) { return encodeURIComponent(String(value)); }
  function add(records, type, id, payload) {
    if (!ALLOWED.has(type)) throw new Error("Type V2 non autorisé : " + type);
    if (!id || !payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Enregistrement invalide : " + type + "/" + id);
    }
    records.push({ entity_type: type, record_id: String(id), payload, deleted_at: null });
  }
  function mapSnapshot(storage) {
    if (!storage || typeof storage.getItem !== "function") throw new Error("Stockage local indisponible");

    const clients = read(storage, KEYS.clients, []);
    const deleted = read(storage, KEYS.deletedClients, []);
    const models = read(storage, KEYS.models, []);
    const assignments = read(storage, KEYS.assignments, {});
    const serials = read(storage, KEYS.serials, {});
    const notifications = read(storage, KEYS.notifications, {});
    const diagnostics = read(storage, KEYS.diagnostics, []);
    const recovery = read(storage, KEYS.recovery, { entries: [] });
    const stockCache = read(storage, KEYS.stockCache, {});
    const stockPending = read(storage, KEYS.stockPending, {});
    const mediaPending = read(storage, KEYS.mediaPending, {});

    const errors = [], warnings = [], records = [];
    if (!Array.isArray(clients)) errors.push("La liste des clients n'est pas un tableau.");
    if (!Array.isArray(deleted)) errors.push("Les marqueurs de suppression clients ne sont pas un tableau.");
    if (!Array.isArray(models)) errors.push("Le catalogue équipements n'est pas un tableau.");
    if (!assignments || typeof assignments !== "object" || Array.isArray(assignments)) errors.push("Les attributions équipements sont invalides.");
    if (!serials || typeof serials !== "object" || Array.isArray(serials)) errors.push("Les numéros de série sont invalides.");
    if (!notifications || typeof notifications !== "object" || Array.isArray(notifications)) errors.push("Les notifications sont invalides.");
    if (!Array.isArray(diagnostics)) errors.push("Les marques de diagnostic ne sont pas un tableau.");
    if (!recovery || typeof recovery !== "object" || !Array.isArray(recovery.entries)) errors.push("Les heures de récupération sont invalides.");
    if (!stockCache || typeof stockCache !== "object" || Array.isArray(stockCache)) errors.push("Le cache du stock est invalide.");
    if (!stockPending || typeof stockPending !== "object" || Array.isArray(stockPending)) errors.push("La file du stock est invalide.");
    if (!mediaPending || typeof mediaPending !== "object" || Array.isArray(mediaPending)) errors.push("La file des pièces jointes est invalide.");
    if (errors.length) return { ok: false, errors, warnings, counts: {}, records: [] };

    const deletedSet = new Set(deleted.map(String));
    const seenClients = new Set();
    const seenModels = new Set();
    const seenDiagnostics = new Set();
    const clientIds = new Set(clients.filter(Boolean).map(c => String(c.id)));
    const modelIds = new Set(models.filter(Boolean).map(m => String(m.id)));

    for (const c of clients) {
      if (!c || c.id == null || String(c.id).trim() === "") { errors.push("Fiche client sans identifiant."); continue; }
      const id = String(c.id);
      if (seenClients.has(id)) { errors.push("Identifiant client en double : " + id + ". Migration bloquée pour éviter toute fusion automatique."); continue; }
      seenClients.add(id);
      if (deletedSet.has(id)) continue;

      const { interventions = [], ...clientPayload } = c;
      add(records, "client", id, clientPayload);
      if (!Array.isArray(interventions)) { errors.push("Interventions invalides pour le client " + id); continue; }
      const occurrences = new Map();
      interventions.forEach((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          errors.push("Intervention invalide pour le client " + id + " (position " + index + ")");
          return;
        }
        const base = String(item.id || item.iso || item.date || "sans-date");
        const occurrence = occurrences.get(base) || 0;
        occurrences.set(base, occurrence + 1);
        const interventionId = id + "::" + idPart(base) + "::" + occurrence;
        add(records, "intervention", interventionId, { client_id: id, legacy_index: index, ...item });
      });
    }

    for (const m of models) {
      if (!m || m.id == null || String(m.id).trim() === "") { errors.push("Modèle équipement sans identifiant."); continue; }
      const id = String(m.id);
      if (seenModels.has(id)) { errors.push("Identifiant modèle en double : " + id); continue; }
      seenModels.add(id);
      const { documents = [], ...modelPayload } = m;
      add(records, "equipment_model", id, modelPayload);
      if (Array.isArray(documents)) documents.forEach((doc, index) => {
        if (!doc || typeof doc !== "object" || typeof doc.data !== "string" || !doc.data) {
          errors.push("Document modèle invalide pour " + id + " (position " + index + ")"); return;
        }
        add(records, "media", id + "::model-document::" + index, {
          owner_type: "equipment_model", owner_id: id, media_type: "document",
          legacy_index: index, name: doc.name || "Document", mime: doc.type || "application/octet-stream", data_url: doc.data
        });
      });
    }

    for (const [clientId, value] of Object.entries(assignments)) {
      if (!clientIds.has(clientId)) warnings.push("Attribution liée à un client absent : " + clientId);
      const list = Array.isArray(value) ? value : (value == null ? [] : [value]);
      list.forEach((installation, index) => {
        const modelId = typeof installation === "string" ? installation :
          (installation && (installation.modelId || installation.model_id || installation.id));
        if (!modelId) { errors.push("Attribution équipement invalide pour " + clientId); return; }
        if (!modelIds.has(String(modelId))) warnings.push("Modèle attribué introuvable : " + modelId + " (client " + clientId + ")");
        add(records, "equipment_installation", clientId + "::" + idPart(modelId), {
          client_id: clientId, model_id: String(modelId), legacy_index: index,
          ...(typeof installation === "object" ? installation : {})
        });
      });
    }

    for (const [clientId, values] of Object.entries(serials)) {
      if (!values || typeof values !== "object" || Array.isArray(values)) {
        errors.push("Numéros de série invalides pour " + clientId); continue;
      }
      const modelKeys = new Set(Object.keys(values).filter(key => !key.startsWith("__year__")));
      for (const modelId of modelKeys) {
        const serial = values[modelId];
        const year = values["__year__" + modelId] || "";
        if (typeof serial !== "string" && serial != null) {
          errors.push("Numéro de série invalide pour " + clientId + "/" + modelId); continue;
        }
        add(records, "equipment_serial", clientId + "::" + idPart(modelId), {
          client_id: clientId, model_id: modelId, serial: String(serial || ""), year: String(year || "")
        });
      }
      for (const yearKey of Object.keys(values).filter(key => key.startsWith("__year__"))) {
        const modelId = yearKey.slice("__year__".length);
        if (!modelKeys.has(modelId)) {
          add(records, "equipment_serial", clientId + "::" + idPart(modelId), {
            client_id: clientId, model_id: modelId, serial: "", year: String(values[yearKey] || "")
          });
        }
      }
    }

    for (const [id, value] of Object.entries(notifications)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        errors.push("Notification invalide : " + id); continue;
      }
      add(records, "notification", id, value);
    }

    for (const d of diagnostics) {
      if (!d || d.id == null || String(d.id).trim() === "") { errors.push("Marque de diagnostic sans identifiant."); continue; }
      const id = String(d.id);
      if (seenDiagnostics.has(id)) { errors.push("Identifiant de marque diagnostic en double : " + id); continue; }
      seenDiagnostics.add(id);
      add(records, "diagnostic_brand", id, d);
      if (Array.isArray(d.documents) && d.documents.length) {
        warnings.push("Documents intégrés conservés dans le payload diagnostic " + id + " ; leur extraction vers le stockage média dédié reste à faire.");
      }
    }

    recovery.entries.forEach((entry, index) => {
      if (!entry || typeof entry.id !== "string" || !entry.id) {
        errors.push("Entrée de récupération sans identifiant (position " + index + ")"); return;
      }
      add(records, "recovery_time", entry.id, { ...entry, dayMinutes: Number(recovery.dayMinutes || 420) });
    });

    deletedSet.forEach(id => add(records, "deletion_marker", id, {
      id, entity_type: "client", deleted: true, source: "metier_clients_deleted_v1"
    }));

    // Le module stock conserve les objets métier dans cache et pending sous forme {key:{value,version}}.
    const stockRows = { ...stockCache };
    for (const [key, pendingRow] of Object.entries(stockPending)) {
      if (pendingRow && Object.prototype.hasOwnProperty.call(pendingRow, "value")) {
        stockRows[key] = { ...(stockRows[key] || {}), value: pendingRow.value };
      }
    }
    for (const [key, wrapper] of Object.entries(stockRows)) {
      if (!key.startsWith("metier_stock_v1_")) continue;
      const item = wrapper && wrapper.value;
      if (!item || typeof item !== "object" || !item.id || !item.kind) {
        errors.push("Enregistrement de stock invalide dans " + key); continue;
      }
      add(records, "stock_item", String(item.kind) + "::" + String(item.id), item);
    }

    // Les pièces jointes du module média sont en attente locale dans une file dédiée.
    for (const [key, item] of Object.entries(mediaPending)) {
      if (!item || typeof item !== "object" || !item.id || !item.scope || !item.ownerId) {
        errors.push("Pièce jointe en attente invalide : " + key); continue;
      }
      if (item.deleted) {
        add(records, "media", String(item.scope) + "::" + String(item.ownerId) + "::" + String(item.id), {
          id: item.id, scope: item.scope, owner_id: String(item.ownerId), deleted: true, deletedAt: item.deletedAt || null
        });
      } else {
        if (typeof item.data !== "string" || !item.data) { errors.push("Contenu de pièce jointe absent : " + key); continue; }
        add(records, "media", String(item.scope) + "::" + String(item.ownerId) + "::" + String(item.id), {
          id: item.id, scope: item.scope, owner_id: String(item.ownerId), code_id: item.codeId || null,
          kind: item.kind || null, name: item.name || "Document", mime: item.mime || null,
          data_url: item.data, created_at: item.createdAt || null
        });
      }
    }
    // Les pièces déjà présentes dans app_sync_state ne sont pas locales : leur migration nécessite un export cloud dédié.
    warnings.push("Les pièces jointes déjà synchronisées dans l'ancien app_sync_state ne sont pas copiées par ce mapping local ; un transfert cloud-à-cloud séparé sera nécessaire.");
    if (diagnostics.some(d => Array.isArray(d.documents) && d.documents.length)) {
      warnings.push("Les documents intégrés aux marques de diagnostic sont conservés dans le payload diagnostic, leur format exact doit être validé.");
    }
    // La version applicative et les clés de configuration/session ne sont pas des données métier.
    const counts = records.reduce((out, row) => {
      out[row.entity_type] = (out[row.entity_type] || 0) + 1;
      return out;
    }, {});
    return { ok: errors.length === 0, errors, warnings, counts, records };
  }

  global.ChabanalV2LegacyMapper = Object.freeze({ mapSnapshot, keys: KEYS });
})(window);
