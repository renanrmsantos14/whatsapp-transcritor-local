(() => {
  "use strict";
  const TYPES = ["HEALTH_CHECK", "CREATE_JOB", "GET_JOB", "CANCEL_JOB", "CACHE_GET", "CACHE_CLEAR", "SETTINGS_GET", "SETTINGS_UPDATE", "DIAGNOSTICS_GET"];
  globalThis.WTProtocol = Object.freeze({ API_VERSION: 2, EXTENSION_VERSION: "0.2.0", TYPES: Object.freeze(TYPES), isKnown: (type) => TYPES.includes(type) });
})();
