/* Chabanal et fils — synchronisation V2 delta (adaptateur isolé)
 * Ne remplace pas l'ancien moteur. À activer uniquement après validation/migration.
 */
(function (global) {
  "use strict";

  const WORKSPACE_ID = "ad49e922-7fd9-447d-b5df-0e5de2ce2554";
  const DEVICE_KEY = "chabanal_v2_delta_device_id";
  const CURSOR_KEY = "chabanal_v2_delta_cursor";
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

    async function save(type, id, payload) {
      assertEntity(type, id, payload);
      await registerDevice();
      const { data, error } = await client.from("app_v2_records").upsert({
        workspace_id: workspaceId, entity_type: type, record_id: id,
        payload, deleted_at: null
      }, { onConflict: "workspace_id,entity_type,record_id" })
        .select("entity_type,record_id,revision,updated_at").single();
      if (error) throw error;
      return data;
    }

    async function remove(type, id, tombstone) {
      if (!ENTITY_TYPES.has(type) || typeof id !== "string" || !id.trim()) {
        throw new Error("Type ou identifiant de suppression invalide");
      }
      await registerDevice();
      const { data, error } = await client.from("app_v2_records").upsert({
        workspace_id: workspaceId, entity_type: type, record_id: id,
        payload: tombstone && typeof tombstone === "object" ? tombstone : { id },
        deleted_at: new Date().toISOString()
      }, { onConflict: "workspace_id,entity_type,record_id" })
        .select("entity_type,record_id,revision,updated_at,deleted_at").single();
      if (error) throw error;
      return data;
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
          if (event.operation === "DELETE") {
            await onChange({ ...event, deleted: true, record: event.payload || null });
          } else {
            const { data: record, error: recordError } = await client.from("app_v2_records")
              .select("entity_type,record_id,payload,revision,updated_at,deleted_at")
              .eq("workspace_id", workspaceId)
              .eq("entity_type", event.entity_type).eq("record_id", event.record_id)
              .maybeSingle();
            if (recordError) throw recordError;
            await onChange({
              ...event, deleted: !!record?.deleted_at,
              record: record || null
            });
          }
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
