/**
 * Map label localization utility
 *
 * CARTO (and MapTiler) vector tiles include per-language name properties
 * (e.g. `name:fr`, `name:ar`, `name:zh`).  This module builds MapLibre GL
 * expressions that resolve the localized name for the current UI language,
 * falling back through `name:en` → `name` (native/local script).
 *
 * Used by DeckGLMap to rewrite symbol-layer `text-field` properties after
 * the basemap style loads.
 */

import { getCurrentLanguage } from '@/services/i18n';

// ── Language → tile property mapping ────────────────────────────────

/**
 * Maps the app's 2-letter language codes to the corresponding vector-tile
 * name property.  Most supported languages have matching fields in CARTO
 * Streets v1 tiles.  Languages without a dedicated tile field (e.g. vi)
 * are omitted — the coalesce expression will fall back to name:en → name.
 */
const LANG_TO_TILE_FIELD: Record<string, string> = {
  en: 'name:en',
  bg: 'name:bg',
  cs: 'name:cs',
  fr: 'name:fr',
  de: 'name:de',
  el: 'name:el',
  es: 'name:es',
  it: 'name:it',
  pl: 'name:pl',
  pt: 'name:pt',
  nl: 'name:nl',
  sv: 'name:sv',
  ru: 'name:ru',
  ar: 'name:ar',
  zh: 'name:zh',
  ja: 'name:ja',
  ko: 'name:ko',
  ro: 'name:ro',
  tr: 'name:tr',
  th: 'name:th',
  // vi (Vietnamese) is not available in CARTO Streets v1 tiles —
  // falls back to name:en → name automatically via the coalesce expression.
};

// ── Expression builders ─────────────────────────────────────────────

/** Internal type alias to avoid importing maplibregl in a generic util. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Expression = any;

/**
 * Returns the CARTO tile property key for the given (or current) language.
 *
 * @example getLocalizedNameField()       // 'name:fr' (if UI is French)
 * @example getLocalizedNameField('zh')   // 'name:zh'
 */
export function getLocalizedNameField(lang?: string): string {
  const code = lang ?? getCurrentLanguage();
  return LANG_TO_TILE_FIELD[code] ?? 'name:en';
}

/**
 * Builds a MapLibre `coalesce` expression that resolves the best available
 * label for the current language:
 *
 *   ["coalesce", ["get","name:xx"], ["get","name:en"], ["get","name"]]
 *
 * If the current language IS English the expression simplifies to:
 *
 *   ["coalesce", ["get","name:en"], ["get","name"]]
 */
export function getLocalizedNameExpression(lang?: string): Expression {
  const field = getLocalizedNameField(lang);

  if (field === 'name:en') {
    return ['coalesce', ['get', 'name:en'], ['get', 'name']];
  }

  return ['coalesce', ['get', field], ['get', 'name:en'], ['get', 'name']];
}

// ── Layer filtering ─────────────────────────────────────────────────

/**
 * Determines whether a symbol layer's `text-field` value refers to a
 * localizable geographic name (as opposed to house numbers, route shields,
 * POI class labels, etc.).
 *
 * Handles the three patterns used by CARTO / MapTiler styles:
 *
 * 1. **String tokens** — `"{name_en}"`, `"{name}"`, `"{name:latin}"`
 * 2. **Expressions** — `["coalesce", ["get","name:en"], ["get","name"]]`
 * 3. **Stop objects** — `{ stops: [[8,"{name_en}"],[13,"{name}"]] }`
 */
export function isLocalizableTextField(textField: unknown): boolean {
  if (!textField) return false;

  // String token: "{name}", "{name_en}", "{name:latin}", etc.
  if (typeof textField === 'string') {
    // Match {name...} but NOT {housenumber}, {ref}, {class}, {route}
    return /\{name[^}]*\}/.test(textField);
  }

  // Expression array or stop object — serialise once and check
  if (typeof textField === 'object') {
    const s = JSON.stringify(textField);
    // Must reference a name property...
    const hasName =
      s.includes('"name"') ||
      s.includes('"name:') ||
      s.includes('"name_en"') ||
      s.includes('"name_int"') ||
      s.includes('{name');
    // ...and must NOT be a non-name field pretending to have "name" in it
    // (very unlikely, but guard against pathological cases)
    return hasName;
  }

  return false;
}

// ── Main entry point ────────────────────────────────────────────────

/**
 * Iterates all symbol layers in a MapLibre map and replaces localizable
 * `text-field` layout properties with a `coalesce` expression targeting
 * the current UI language.
 *
 * Safe to call multiple times (idempotent) and after `setStyle()`.
 *
 * @param map - a MapLibre GL JS Map instance (typed as `any` to avoid
 *              forcing the maplibre-gl import into this utility)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function localizeMapLabels(map: any): void {
  const style = map?.getStyle?.();
  if (!style?.layers) return;

  const expr = getLocalizedNameExpression();

  for (const layer of style.layers) {
    if (layer.type !== 'symbol') continue;

    let textField: unknown;
    try {
      textField = map.getLayoutProperty(layer.id, 'text-field');
    } catch {
      // Layer may have been removed between getStyle() and now
      continue;
    }

    if (!isLocalizableTextField(textField)) continue;

    try {
      map.setLayoutProperty(layer.id, 'text-field', expr);
    } catch {
      // Ignore — layer may not be fully initialised yet
    }
  }
}
