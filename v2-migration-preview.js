/* Chabanal et fils — point d'entrée de prévisualisation migration V2.
 * Ne contacte pas Supabase et ne modifie aucun stockage.
 */
(function (global) {
  "use strict";
  function preview(storage) {
    if (!global.ChabanalV2LegacyMapper) throw new Error("Le mapper V2 n'est pas chargé.");
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
  global.ChabanalV2MigrationPreview = Object.freeze({
    run: () => preview(global.localStorage),
    runAgainst: preview,
    syncAvailable: () => !!global.ChabanalV2DeltaSync
  });
})(window);
