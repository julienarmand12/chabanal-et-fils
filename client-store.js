/* Stockage IndexedDB des fiches clients — migration progressive.
 * Ne supprime jamais la copie localStorage : elle reste disponible pour retour arrière.
 * Cette couche est volontairement indépendante ; l'application ne bascule dessus
 * qu'après adaptation du démarrage et de la synchronisation Supabase.
 */
(function () {
  "use strict";

  const DB_NAME = "chabanal_clients_db";
  const DB_VERSION = 1;
  const STORE = "snapshots";
  const RECORD_ID = "clients";
  const LEGACY_KEY = "metier_clients_v1_2_corrigee";
  let dbPromise;
  let writeChain = Promise.resolve();

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB n'est pas disponible sur cet appareil."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error("Ouverture IndexedDB impossible."));
      request.onblocked = () => reject(new Error("Une autre version de l'application bloque l'ouverture du stockage."));
    });
    return dbPromise;
  }

  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Lecture IndexedDB impossible."));
    });
  }

  async function readRecord() {
    const db = await openDB();
    const tx = db.transaction(STORE, "readonly");
    return requestValue(tx.objectStore(STORE).get(RECORD_ID));
  }

  async function writeRecord(value, source) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({
        id: RECORD_ID,
        value,
        count: value.length,
        updatedAt: new Date().toISOString(),
        source: source || "application"
      });
      tx.oncomplete = () => resolve({ count: value.length });
      tx.onerror = () => reject(tx.error || new Error("Écriture IndexedDB impossible."));
      tx.onabort = () => reject(tx.error || new Error("Écriture IndexedDB annulée."));
    });
  }

  function validateClients(value) {
    if (!Array.isArray(value)) throw new Error("La base clients reçue n'est pas une liste.");
    if (value.some(c => !c || typeof c !== "object" || c.id == null)) {
      throw new Error("La base contient une fiche sans identifiant : écriture interrompue.");
    }
    return value;
  }

  async function load() {
    const record = await readRecord();
    if (record && Array.isArray(record.value)) {
      validateClients(record.value);
      return { clients: record.value, source: "indexeddb", migrated: false };
    }

    // Migration initiale non destructive : lire le localStorage, écrire IndexedDB,
    // puis relire et comparer avant de déclarer la migration réussie.
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw === null) {
      return { clients: null, source: "empty", migrated: false };
    }
    let legacy;
    try { legacy = JSON.parse(raw); }
    catch (_) { throw new Error("La sauvegarde locale des clients est illisible ; aucune donnée n'a été modifiée."); }
    validateClients(legacy);
    await writeRecord(legacy, "migration-localstorage");
    const verified = await readRecord();
    if (!verified || !Array.isArray(verified.value) ||
        verified.value.length !== legacy.length ||
        JSON.stringify(verified.value) !== JSON.stringify(legacy)) {
      throw new Error("La vérification après migration a échoué ; la copie locale d'origine est conservée.");
    }
    return { clients: verified.value, source: "localstorage-migrated", migrated: true };
  }

  function save(clients) {
    const snapshot = JSON.parse(JSON.stringify(validateClients(clients)));
    const operation = writeChain.then(() => writeRecord(snapshot, "application"));
    writeChain = operation.catch(() => {});
    return operation;
  }

  function replaceFromCloud(clients) {
    const snapshot = JSON.parse(JSON.stringify(validateClients(clients)));
    // Sérialiser le remplacement cloud avec les sauvegardes locales. Sans cela,
    // une sauvegarde lancée pendant l'attente pourrait écraser la copie cloud.
    const operation = writeChain.then(async () => {
      const result = await writeRecord(snapshot, "supabase");
      const verified = await readRecord();
      if (!verified || JSON.stringify(verified.value) !== JSON.stringify(snapshot)) {
        throw new Error("La copie cloud n'a pas pu être vérifiée dans IndexedDB.");
      }
      return result;
    });
    writeChain = operation.catch(() => {});
    return operation;
  }

  async function exportLegacyCopy() {
    const record = await readRecord();
    if (!record) return null;
    return JSON.stringify(record.value);
  }

  async function status() {
    const record = await readRecord();
    return record ? {
      ready: true,
      count: record.count,
      updatedAt: record.updatedAt,
      source: record.source
    } : { ready: false, count: 0 };
  }

  window.ChabanalClientStore = Object.freeze({
    load,
    save,
    replaceFromCloud,
    exportLegacyCopy,
    status,
    flush: () => writeChain
  });
})();
