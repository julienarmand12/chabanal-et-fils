/* Chabanal et fils — synchronisation V2 delta (adaptateur isolé)
 * Ne remplace pas l'ancien moteur. À activer uniquement après validation/migration.
 */
(function (global) {
  "use strict";

  const WORKSPACE_ID = "2d32b34b-66d8-416b-a369-37f564eb7c99";
  const DEVICE_KEY = "chabanal_test2_v2_delta_device_id";
  const CURSOR_KEY = "chabanal_test2_v2_delta_cursor";
  const PAGE_SIZE = 250;
  const ENTITY_TYPES = new Set([
    "client", "intervention", "equipment_model", "equipment_installation",
    "equipment_serial", "media", "stock_item", "notification",
    "diagnostic_brand", "recovery_time", "deletion_marker"
  ]);

  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") return global.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }

  function deviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = uuid(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  }

  function cursor() {
    const n = Number(localStorage.getItem(CURSOR_KEY) || 0);
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  }

  function assertEntity(type, id, payload) {
    if (!ENTITY_TYPES.has(type)) throw new Error("Type d'enregistrement V2 non autorisé : " + type);
    if (typeof id !== "string" || !id.trim()) throw new Error("Identifiant d'enregistrement obligatoire");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Le contenu doit être un objet JSON");
    }
  }

  function create(client, options) {
    if (!client || typeof client.from !== "function") throw new Error("Client Supabase invalide");
    const workspaceId = options && options.workspaceId || WORKSPACE_ID;
    const label = options && options.deviceLabel || (global.navigator && navigator.userAgent ? navigator.userAgent.slice(0, 120) : "Appareil");

    async function registerDevice() {
      const id = deviceId();
      const { error } = await client.from("app_v2_devices").upsert({
        id, workspace_id: workspaceId, device_label: label, last_seen_at: new Date().toISOString()
      }, { onConflict: "id" });
      if (error) throw error;
      return id;
    }

    async function writeCAS(type, id, payload, deletedAt, expectedRevision) {
      const current = await client.from("app_v2_records")
        .select("revision").eq("workspace_id", workspaceId)
        .eq("entity_type", type).eq("record_id", id).maybeSingle();
      if (current.error) throw current.error;
      const row = {
        workspace_id: workspaceId, entity_type: type, record_id: id,
        payload, deleted_at: deletedAt || null
      };
      if (!current.data) {
        if (expectedRevision != null) throw new Error("Conflit : la fiche attendue n'existe plus sur le serveur.");
        const inserted = await client.from("app_v2_records").insert(row)
          .select("entity_type,record_id,revision,updated_at,deleted_at").maybeSingle();
        if (inserted.error) throw inserted.error;
        if (!inserted.data) throw new Error("Conflit : l'enregistrement a été créé par un autre appareil.");
        return inserted.data;
      }
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
        throw new Error("Révision locale obligatoire pour modifier une fiche existante.");
      }
      if (current.data.revision !== expectedRevision) {
        throw new Error("Conflit : la fiche a été modifiée sur un autre appareil. Synchronisez avant de réessayer.");
      }
      const updated = await client.from("app_v2_records").update(row)
        .eq("workspace_id", workspaceId).eq("entity_type", type)
        .eq("record_id", id).eq("revision", current.data.revision)
        .select("entity_type,record_id,revision,updated_at,deleted_at").maybeSingle();
      if (updated.error) throw updated.error;
      if (!updated.data) throw new Error("Conflit de synchronisation : une autre modification est arrivée. Relisez avant de réessayer.");
      return updated.data;
    }

    async function save(type, id, payload, expectedRevision) {
      assertEntity(type, id, payload);
      await registerDevice();
      return writeCAS(type, id, payload, null, expectedRevision);
    }

    async function remove(type, id, tombstone, expectedRevision) {
      if (!ENTITY_TYPES.has(type) || typeof id !== "string" || !id.trim()) {
        throw new Error("Type ou identifiant de suppression invalide");
      }
      await registerDevice();
      const deletedAt = new Date().toISOString();
      const payload = tombstone && typeof tombstone === "object" ? { ...tombstone } : { id };
      payload.__deleted = true;
      payload.__deleted_at = deletedAt;
      return writeCAS(type, id, payload, deletedAt, expectedRevision);
    }

    async function pullDelta(onChange) {
      if (typeof onChange !== "function") throw new Error("Un gestionnaire de changements est requis");
      await registerDevice();
      let next = cursor();
      let processed = 0;
      for (;;) {
        const { data: events, error } = await client.from("app_v2_change_log")
          .select("seq,entity_type,record_id,operation,revision,payload,changed_at")
          .eq("workspace_id", workspaceId).gt("seq", next)
          .order("seq", { ascending: true }).limit(PAGE_SIZE);
        if (error) throw error;
        if (!events || !events.length) break;

        for (const event of events) {
          // Le journal contient le snapshot de l'événement : ne pas relire la ligne courante,
          // qui pourrait déjà représenter une modification ultérieure.
          await onChange({
            ...event,
            deleted: String(event.operation).toLowerCase() === "delete" || !!event.payload?.__deleted,
            record: event.payload || null
          });
          // Le curseur avance uniquement après traitement réussi de l'événement.
          next = Number(event.seq);
          localStorage.setItem(CURSOR_KEY, String(next));
          processed++;
        }
        if (events.length < PAGE_SIZE) break;
      }

      const id = deviceId();
      const { error: cursorError } = await client.from("app_v2_sync_cursors").upsert({
        workspace_id: workspaceId, device_id: id, last_seq: next,
        updated_at: new Date().toISOString()
      }, { onConflict: "workspace_id,device_id" });
      if (cursorError) throw cursorError;
      return { cursor: next, processed };
    }

    async function getStatus() {
      const { data, error } = await client.from("app_v2_workspaces")
        .select("id,change_seq,updated_at").eq("id", workspaceId).single();
      if (error) throw error;
      return { workspace: data, deviceId: deviceId(), localCursor: cursor() };
    }

    return Object.freeze({ save, remove, pullDelta, getStatus, registerDevice, deviceId: deviceId() });
  }

  global.ChabanalV2DeltaSync = Object.freeze({ create, workspaceId: WORKSPACE_ID });
})(window);
