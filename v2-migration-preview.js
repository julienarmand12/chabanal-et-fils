/* Chabanal et fils — intégration V2 progressive et sans écriture
 * Cette étape expose un diagnostic local en lecture seule.
 * Aucun appel réseau, aucune écriture Supabase, aucune modification localStorage.
 */
(function (global) {
  "use strict";

  function preview(storage) {
    if (!global.ChabanalV2LegacyMapper) {
      throw new Error("Le mapper V2 n'est pas chargé.");
    }
    const result = global.ChabanalV2LegacyMapper.mapSnapshot(storage || global.localStorage);
    const bytes = result.records.reduce((sum, row) => {
      try { return sum + new Blob([JSON.stringify(row)]).size; }
      catch (_) { return sum + JSON.stringify(row).length * 2; }
    }, 0);
    return Object.freeze({
      ok: result.ok,
      counts: result.counts,
      totalRecords: result.records.length,
      approximatePayloadBytes: bytes,
      errors: result.errors,
      warnings: result.warnings
    });
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function renderResult(container, result) {
    container.replaceChildren();
    const status = result.ok
      ? "Inventaire local terminé — aucune donnée envoyée."
      : "Inventaire bloqué — corriger les erreurs avant toute migration.";
    container.appendChild(element("p", status));
    container.appendChild(element("p",
      result.totalRecords + " enregistrements détectés · environ " +
      result.approximatePayloadBytes.toLocaleString("fr-FR") + " octets de payload métier."));
    const counts = element("ul");
    Object.entries(result.counts || {}).sort(([a], [b]) => a.localeCompare(b))
      .forEach(([type, count]) => counts.appendChild(element("li", type + " : " + count)));
    if (counts.childNodes.length) {
      container.appendChild(element("strong", "Répartition"));
      container.appendChild(counts);
    }
    if (result.errors.length) {
      container.appendChild(element("strong", "Erreurs"));
      const list = element("ul");
      result.errors.forEach(item => list.appendChild(element("li", item)));
      container.appendChild(list);
    }
    if (result.warnings.length) {
      container.appendChild(element("strong", "Points à traiter"));
      const list = element("ul");
      result.warnings.forEach(item => list.appendChild(element("li", item)));
      container.appendChild(list);
    }
  }

  function mount() {
    const panel = document.getElementById("cloudSyncPanel");
    if (!panel || document.getElementById("v2LocalPreviewPanel")) return;
    const section = element("section", null, "section");
    section.id = "v2LocalPreviewPanel";
    section.style.cssText = "margin-top:14px;padding-top:12px;border-top:1px solid #45617b";
    section.appendChild(element("h3", "🧪 Moteur V2 — contrôle préalable"));
    section.appendChild(element("p",
      "Étape de préparation uniquement : lecture des données locales et inventaire. " +
      "La synchronisation V2 et la migration restent désactivées."));
    const button = element("button", "Analyser les données locales (lecture seule)", "secondary small");
    button.type = "button";
    const output = element("div");
    output.className = "muted small";
    output.style.cssText = "margin-top:10px;overflow-wrap:anywhere";
    button.addEventListener("click", function () {
      button.disabled = true;
      button.textContent = "Analyse en cours…";
      try {
        renderResult(output, preview(global.localStorage));
      } catch (error) {
        output.replaceChildren(element("p",
          "Analyse impossible : " + (error && error.message ? error.message : String(error))));
      } finally {
        button.disabled = false;
        button.textContent = "Analyser les données locales (lecture seule)";
      }
    });
    section.appendChild(button);
    section.appendChild(output);
    panel.appendChild(section);
  }

  global.ChabanalV2MigrationPreview = Object.freeze({
    run: () => preview(global.localStorage),
    runAgainst: preview,
    syncAvailable: () => !!global.ChabanalV2DeltaSync,
    mount
  });

  function loadMergePreview() {
    if (document.getElementById("v2MergePreviewScript")) return;
    const script = document.createElement("script");
    script.id = "v2MergePreviewScript";
    script.src = "./v2-inbound-merge-preview.js?v=20261125-1";
    script.defer = true;
    document.head.appendChild(script);
  }

  function loadInboundStaging() {
    if (document.getElementById("v2InboundStagingScript")) return;
    const script = document.createElement("script");
    script.id = "v2InboundStagingScript";
    script.src = "./v2-inbound-staging.js?v=20261125-1";
    script.defer = true;
    document.head.appendChild(script);
  }

  function loadMediaInventory() {
    if (document.getElementById("v2MediaInventoryScript")) return;
    const script = document.createElement("script");
    script.id = "v2MediaInventoryScript";
    script.src = "./v2-media-inventory.js?v=20261125-1";
    script.onload = function () { global.ChabanalV2MediaInventory?.mount(); };
    script.defer = true; document.head.appendChild(script);
  }

  function loadOperationBridge() {
    if (document.getElementById("v2OperationBridgeScript")) return;
    const script = document.createElement("script");
    script.id = "v2OperationBridgeScript";
    script.src = "./v2-operation-bridge.js?v=20261125-1";
    script.defer = true;
    document.head.appendChild(script);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { mount(); loadOperationBridge(); loadMergePreview(); loadInboundStaging(); loadMediaInventory(); }, { once: true });
  } else {
    mount();
    loadOperationBridge();
    loadInboundStaging();
    loadMediaInventory();
  }
})(window);
