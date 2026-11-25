/* Chabanal et fils — réception V2 en zone tampon
 * Récupère les événements V2 mais ne modifie JAMAIS les clés métier V1.
 * La conversion et l'application V2 -> V1 nécessitent une validation distincte.
 */
(function (global) {
  "use strict";
  const INBOX_KEY = "chabanal_v2_inbound_staging";
  const META_KEY = "chabanal_v2_inbound_staging_meta";
  const MAX_EVENTS = 2000;
  const MAX_BYTES = 3 * 1024 * 1024;
  let busy = false;

  function readInbox() {
    try {
      const value = JSON.parse(localStorage.getItem(INBOX_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (_) { throw new Error("La zone tampon V2 est illisible. Aucun événement n'a été appliqué à la V1."); }
  }
  function safeEvent(event) {
    if (!event || !Number.isSafeInteger(Number(event.seq)) || !event.entity_type ||
        typeof event.record_id !== "string" || !event.record_id) {
      throw new Error("Événement V2 incomplet : réception interrompue.");
    }
    const payload = event.record;
    if (payload && JSON.stringify(payload).includes("data_url")) {
      throw new Error("Un média contient encore une Data URL : réception suspendue sans avancer le curseur.");
    }
    if (event.entity_type === "media" && payload && !payload.storage_path && !payload.deleted) {
      throw new Error("Référence Storage privée absente pour un média : réception suspendue.");
    }
    return {
      seq: Number(event.seq), entity_type: event.entity_type, record_id: event.record_id,
      operation: event.operation || (event.deleted ? "delete" : "upsert"),
      revision: Number(event.revision || 0), changed_at: event.changed_at || null,
      deleted: !!event.deleted, payload: payload || null
    };
  }
  function stage(event) {
    const row = safeEvent(event);
    const inbox = readInbox();
    const existing = inbox.findIndex(x => x.seq === row.seq);
    if (existing >= 0) return { duplicate: true, count: inbox.length };
    if (inbox.length >= MAX_EVENTS) throw new Error("Zone tampon pleine (2 000 événements). Exportez ou examinez les événements avant de continuer.");
    const next = inbox.concat(row);
    const serialized = JSON.stringify(next);
    if (serialized.length * 2 > MAX_BYTES) throw new Error("Zone tampon proche de la limite de sécurité (3 Mo). Aucun événement supplémentaire n'a été enregistré.");
    localStorage.setItem(INBOX_KEY, serialized);
    return { duplicate: false, count: next.length };
  }
  async function pull(client) {
    if (busy) throw new Error("Une réception V2 est déjà en cours.");
    if (!global.ChabanalV2DeltaSync) throw new Error("Moteur delta V2 indisponible.");
    busy = true;
    try {
      if (!client || typeof client.from !== "function") throw new Error("Client Supabase non fourni. La V1 ne l’expose pas encore aux modules V2 ; aucune réception effectuée.");\n      const sync = global.ChabanalV2DeltaSync.create(client);
      const result = await sync.pullDelta(async event => { stage(event); });
      const meta = { lastPullAt: new Date().toISOString(), cursor: result.cursor, processed: result.processed };
      localStorage.setItem(META_KEY, JSON.stringify(meta));
      return { ...result, staged: readInbox().length };
    } finally { busy = false; }
  }
  function status() {
    const inbox = readInbox();
    let meta = {};
    try { meta = JSON.parse(localStorage.getItem(META_KEY) || "{}"); } catch (_) {}
    return { count: inbox.length, meta };
  }
  function clearAfterExport() {
    const inbox = readInbox();
    if (!inbox.length) return { cleared: 0 };
    if (!global.confirm("Supprimer les " + inbox.length + " événements de la zone tampon ? Cette action ne touche pas aux données V1.")) {
      return { cancelled: true };
    }
    localStorage.removeItem(INBOX_KEY);
    return { cleared: inbox.length };
  }
  function exportJson() {
    const data = JSON.stringify({ exported_at: new Date().toISOString(), events: readInbox() }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "chabanal-v2-evenements-a-integrer.json";
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    return readInbox().length;
  }
  global.ChabanalV2InboundStaging = Object.freeze({ pull, status, exportJson, clearAfterExport });
})(window);
