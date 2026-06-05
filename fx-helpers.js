/*
 * fx-helpers.js — font-agnostic runtime for the Fluxetype Webflow store.
 *
 * Loaded once, site-wide (Project Settings → Custom code → Head code, wrapped
 * in <script>). Holds NO font data — every section reads the current font from
 * a per-page JSON config injected by the CMS into:
 *
 *   <script id="fx-config" type="application/json">{ ...compact config... }</script>
 *
 * The config shape is produced by build-config.py --format json:
 *   { family, fontUrl, format, weightRange:[min,max],
 *     axes:[{tag,label,min,default,max}], features:[{tag,label,on}],
 *     instanceAxes:[tag...], instances:[[name, v0, v1, ...], ...],
 *     size:{min,max,start}, ctrsStart?, glyphGroups?, alternates? }
 *
 * These mirror the helpers in framer/code-components/Fluxetype_config.ts, but
 * take axes/features as arguments instead of importing module-level constants,
 * so one copy serves every typeface in the catalog.
 */
(function (window, document) {
  "use strict";

  var FX = {
    /** Parsed config for the current page, set by loadConfig(). */
    config: null,
  };

  /**
   * Read and parse the per-page font config from a <script type="application/json">.
   * Caches the result on FX.config. Returns the config object, or null if the
   * tag is missing or the JSON is invalid (logs a warning).
   * @param {string} [selector="#fx-config"]
   */
  FX.loadConfig = function (selector) {
    var el = document.querySelector(selector || "#fx-config");
    if (!el) {
      console.warn("[FX] config script not found:", selector || "#fx-config");
      return null;
    }
    try {
      FX.config = JSON.parse(el.textContent);
    } catch (err) {
      console.warn("[FX] failed to parse config JSON:", err);
      return null;
    }
    return FX.config;
  };

  /** Find an axis descriptor by tag (case-insensitive). */
  FX.findAxis = function (axes, tag) {
    var t = String(tag).toLowerCase();
    for (var i = 0; i < axes.length; i++) {
      if (axes[i].tag.toLowerCase() === t) return axes[i];
    }
    return null;
  };

  /**
   * Build a font-variation-settings string for any set of axes.
   * Missing axes fall back to their default from `axes`.
   * @param {Object} coords  e.g. { wght: 560, CTRS: 80 }
   * @param {Array}  axes    config.axes
   * @returns {string}       e.g. "'CTRS' 80, 'XHGT' 70, 'wght' 560"
   */
  FX.variationStringFromCoords = function (coords, axes) {
    coords = coords || {};
    return axes
      .map(function (a) {
        var v = coords[a.tag] !== undefined ? coords[a.tag] : a.default;
        return "'" + a.tag + "' " + v;
      })
      .join(", ");
  };

  /**
   * Build a font-feature-settings string from a tag→bool map.
   * @param {Object} state    e.g. { liga: true, onum: false }
   * @param {Array}  features config.features
   * @returns {string}        e.g. "'liga' 1, 'onum' 0"
   */
  FX.featureString = function (state, features) {
    state = state || {};
    return features
      .map(function (f) {
        return "'" + f.tag + "' " + (state[f.tag] ? 1 : 0);
      })
      .join(", ");
  };

  /** Initial feature toggle state ({tag: on}) from config.features. */
  FX.initialFeatureState = function (features) {
    var s = {};
    features.forEach(function (f) {
      s[f.tag] = !!f.on;
    });
    return s;
  };

  /** Default coords ({tag: default}) from config.axes. */
  FX.defaultCoords = function (axes) {
    var c = {};
    axes.forEach(function (a) {
      c[a.tag] = a.default;
    });
    return c;
  };

  /**
   * Expand the compact positional instances into objects, mirroring the old
   * INSTANCES array: [{ name, <axisTag>: value, ... }, ...].
   * Reads cfg.instanceAxes for the column order. Returns [] if absent.
   * @param {Object} cfg  config object (or uses FX.config)
   */
  FX.expandInstances = function (cfg) {
    cfg = cfg || FX.config;
    if (!cfg || !cfg.instances || !cfg.instanceAxes) return [];
    var order = cfg.instanceAxes;
    return cfg.instances.map(function (row) {
      var obj = { name: row[0] };
      for (var i = 0; i < order.length; i++) {
        obj[order[i]] = row[i + 1];
      }
      return obj;
    });
  };

  /**
   * Inject an @font-face built from the config into the page <head>. Use this
   * when you prefer JS over a CMS-bound @font-face embed. Idempotent per family.
   * The family is also exposed as the CSS var --fx-family on :root so sections
   * can pick it up via font-family: var(--fx-family).
   * @param {Object} cfg  config object (or uses FX.config)
   */
  FX.injectFontFace = function (cfg) {
    cfg = cfg || FX.config;
    if (!cfg || !cfg.fontUrl || !cfg.family) return;
    var id = "fx-face-" + cfg.family.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    if (document.getElementById(id)) return;
    var w = cfg.weightRange || [100, 900];
    var fmt = cfg.format || "woff2-variations";
    var fallback = fmt.split("-")[0]; // "woff2-variations" → "woff2"
    var css =
      "@font-face{font-family:'" + cfg.family + "';" +
      "src:url('" + cfg.fontUrl + "') format('" + fmt + "')," +
      "url('" + cfg.fontUrl + "') format('" + fallback + "');" +
      "font-weight:" + w[0] + " " + w[1] + ";font-display:swap;}" +
      ":root{--fx-family:'" + cfg.family + "';}";
    var style = document.createElement("style");
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  };

  /**
   * Convenience boot: parse the page config, inject the @font-face, and fire a
   * "fx:ready" event so section embeds can initialise against FX.config without
   * worrying about script order.
   */
  FX.init = function (selector) {
    var cfg = FX.loadConfig(selector);
    if (cfg) FX.injectFontFace(cfg);
    window.dispatchEvent(new CustomEvent("fx:ready", { detail: { config: cfg } }));
    return cfg;
  };

  window.FX = FX;

  // Auto-init once the DOM is parsed, if a config tag is present. Section embeds
  // should listen for "fx:ready" (or check FX.config) rather than assume timing.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (document.getElementById("fx-config")) FX.init();
    });
  } else {
    if (document.getElementById("fx-config")) FX.init();
  }
})(window, document);
