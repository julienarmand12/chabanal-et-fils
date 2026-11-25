/* Chabanal et fils — préparation de fusion V2 -> V1
 * Mapping inverse conservateur : construit un plan, ne modifie jamais localStorage.
 */
(function (global) {
  "use strict";
  const CLIENTS_KEY = "metier_clients_v1_2_corrigee";
  const DELETED_KEY = "metier_clients_deleted_v1";
  function parse(storage, key, fallback) {
    const raw = storage.getItem(key);
    if (raw == null) return fallback;
    try { return JSON.parse(raw); }
    catch (_) { throw new Error("Donnée locale illisible : " + key); }
  }
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      const out = {};
      Object.keys(value).sort().forEach(k => { out[k] = stable(value[k]); });
      return out;
    }
    return value;
  }
  function same(a, b) { return JSON.stringify(stable(a)) === JSON.stringify(stable(b)); }
  function clientCore(value) {
    const out = { ...value };
    delete out.interventions;
    return out;
  }
  function mapPlan(events, storage) {
    if (!Array.isArray(events)) throw new Error("Liste d'événements V2 invalide.");
    if (!storage || typeof storage.getItem !== "function") throw new Error("Stockage local indisponible.");
    const clients = parse(storage, CLIENTS_KEY, []);
    const deleted = new Set((parse(storage, DELETED_KEY, []) || []).map(String));
    if (!Array.isArray(clients)) throw new Error("La liste clients V1 n'est pas un tableau.");
    const byId = new Map(clients.filter(c => c && c.id != null).map(c => [String(c.id), c]));
    const incomingClients = new Map(), incomingInterventions = new Map(), actions = [], unsupported = [];
    for (const event of events) {
      const p = event && event.payload;
      if (!event || !p || typeof p !== "object") { unsupported.push({seq:event?.seq||null,reason:"Payload absent"}); continue; }
      if (event.deleted || event.operation === "delete" || p.__deleted || p.deleted) {
        actions.push({seq:event.seq,type:event.entity_type,id:event.record_id,status:"manual-delete-review",reason:"Une suppression V2 ne supprime jamais automatiquement une donnée V1."});
        continue;
      }
      if (event.entity_type === "client") {
        const id = String(event.record_id);
        if (!p.id || String(p.id) !== id) { unsupported.push({seq:event.seq,reason:"Identifiant client incohérent"}); continue; }
        incomingClients.set(id, { ...p });
      } else if (event.entity_type === "intervention") {
        const clientId = String(p.client_id || "");
        if (!clientId || !clientId.trim()) { unsupported.push({seq:event.seq,reason:"Intervention sans client_id"}); continue; }
        if (!incomingInterventions.has(clientId)) incomingInterventions.set(clientId, []);
        const item = { ...p };
        delete item.client_id; delete item.legacy_index;
        incomingInterventions.get(clientId).push({ seq:event.seq, legacy_index:p.legacy_index, item });
      } else {
        unsupported.push({seq:event.seq,type:event.entity_type,reason:"Type non encore réversible vers les clés V1."});
      }
    }
    for (const [id, remote] of incomingClients) {
      const local = byId.get(id);
      const interventions = (incomingInterventions.get(id) || []).sort((a,b) =>
        Number(a.legacy_index ?? a.seq) - Number(b.legacy_index ?? b.seq));
      const proposedInterventions = [];
      const currentInterventions = local && Array.isArray(local.interventions) ? local.interventions : [];
      for (const entry of interventions) {
        const item = entry.item;
        const duplicate = currentInterventions.some(x =>
          x && String(x.iso || x.date || "") === String(item.iso || item.date || "") &&
          String(x.description || "") === String(item.description || ""));
        if (!duplicate) proposedInterventions.push(item);
      }
      if (!local) {
        if (deleted.has(id)) {
          actions.push({type:"client",id,status:"conflict",reason:"Cet identifiant figure dans les marqueurs de suppression V1.",interventions:proposedInterventions});
        } else {
          actions.push({type:"client",id,status:"new-client-candidate",reason:"Identifiant absent de V1 : création possible après validation manuelle.",client:remote,interventions:proposedInterventions});
        }
      } else if (same(clientCore(local), clientCore(remote))) {
        actions.push({type:"client",id,status:"review-append-only",reason:"Les champs principaux concordent ; les interventions manquantes sont proposées sans écriture automatique.",interventions:proposedInterventions,duplicateInterventions:interventions.length-proposedInterventions.length});
      } else {
        actions.push({type:"client",id,status:"conflict",reason:"Les champs principaux V1 et V2 diffèrent : arbitrage humain nécessaire.",local:clientCore(local),remote:clientCore(remote),interventions:proposedInterventions});
      }
    }
    for (const [id, entries] of incomingInterventions) {
      if (!incomingClients.has(id)) actions.push({type:"intervention",id,status:"orphan-review",reason:"Interventions reçues sans événement client correspondant dans la zone tampon.",count:entries.length});
    }
    const counts = actions.reduce((out,a) => { out[a.status]=(out[a.status]||0)+1; return out; }, {});
    return {
      generated_at:new Date().toISOString(),
      mode:"preview-only",
      writes_performed:false,
      safety:"Aucune écriture localStorage, aucun appel réseau, aucune suppression ou fusion automatique.",
      counts, actions, unsupported
    };
  }
  global.ChabanalV2MergePreview = Object.freeze({ mapPlan });
})(window);
