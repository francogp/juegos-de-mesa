/**
 * Ludoteca · Capa de Datos y Persistencia
 * Gestiona dos bases de datos independientes:
 * 1. Base Oficial (solo lectura, cargada desde data/games.json del repositorio)
 * 2. Mi Ludoteca (base personalizada completa en localStorage, editable e importable/exportable)
 */
(function () {
  const CUSTOM_DB_KEY = 'ludoteca_custom_games_v2';
  const ACTIVE_SOURCE_KEY = 'ludoteca_active_source_v1';
  const LEGACY_DELTA_KEY = 'ludoteca_custom_delta_v1';
  const THEME_KEY = 'ludoteca_theme_v1';

  function slugify(text) {
    return (
      String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'juego-' + Date.now()
    );
  }

  function normalizeGame(raw, { isCustom = false } = {}) {
    const esName = String(raw.esName || raw.originalName || '').trim();
    const originalName = String(raw.originalName || esName).trim();
    const min = Math.max(1, parseInt(raw.min, 10) || 1);
    const max = Math.max(min, parseInt(raw.max, 10) || min);
    const minTime = Math.max(5, parseInt(raw.minTime, 10) || 30);
    const maxTime = Math.max(minTime, parseInt(raw.maxTime, 10) || minTime);
    const validComplexities = ['ligero', 'medio', 'experto'];
    const complexity = validComplexities.includes(raw.complexity) ? raw.complexity : 'medio';
    const validModes = ['competitivo', 'cooperativo', 'ambos'];
    const mode = validModes.includes(raw.mode) ? raw.mode : 'competitivo';

    const tags = Array.isArray(raw.tags)
      ? raw.tags.map((t) => String(t).trim()).filter(Boolean)
      : String(raw.tags || '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);

    const bggUrl = raw.bggUrl ? String(raw.bggUrl).trim() : '';
    const coverUrl = raw.coverUrl ? String(raw.coverUrl).trim() : '';

    return {
      id: String(raw.id || slugify(esName)),
      esName,
      originalName,
      ...(bggUrl ? { bggUrl } : {}),
      ...(coverUrl ? { coverUrl } : {}),
      min,
      max,
      minTime,
      maxTime,
      complexity,
      mode,
      tags: tags.slice(0, 5),
      description: String(raw.description || '').trim(),
      isCustom: Boolean(isCustom)
    };
  }

  function sortGames(list) {
    return [...list].sort((a, b) =>
      a.esName.localeCompare(b.esName, 'es', { sensitivity: 'base' })
    );
  }

  async function fetchBaseGames() {
    try {
      const response = await fetch('./data/games.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        return sortGames(data.map((g) => normalizeGame(g, { isCustom: false })));
      }
    } catch {
      // Respaldo para protocolo file:// o sin red previa al Service Worker
    }
    const fallback = Array.isArray(window.DEFAULT_GAMES) ? window.DEFAULT_GAMES : [];
    return sortGames(fallback.map((g) => normalizeGame(g, { isCustom: false })));
  }

  function migrateLegacyDeltaIfPresent(baseGames) {
    try {
      const rawLegacy = localStorage.getItem(LEGACY_DELTA_KEY);
      if (!rawLegacy) return null;
      const parsed = JSON.parse(rawLegacy);
      const upserts = parsed && typeof parsed.upserts === 'object' ? parsed.upserts : {};
      const deletedIds = Array.isArray(parsed && parsed.deletedIds) ? parsed.deletedIds : [];
      localStorage.removeItem(LEGACY_DELTA_KEY);

      if (Object.keys(upserts).length === 0 && deletedIds.length === 0) {
        return null;
      }

      const deletedSet = new Set(deletedIds);
      const map = new Map();
      for (const base of baseGames) {
        if (!deletedSet.has(base.id)) {
          map.set(base.id, normalizeGame(base, { isCustom: true }));
        }
      }
      for (const [id, customRaw] of Object.entries(upserts)) {
        if (deletedSet.has(id)) continue;
        map.set(id, normalizeGame({ ...customRaw, id }, { isCustom: true }));
      }
      return sortGames(Array.from(map.values()));
    } catch {
      return null;
    }
  }

  function saveCustomGames(gamesArray) {
    const clean = sortGames(gamesArray.map((g) => normalizeGame(g, { isCustom: true })));
    try {
      localStorage.setItem(CUSTOM_DB_KEY, JSON.stringify(clean));
    } catch (err) {
      console.warn('No se pudo guardar Mi Ludoteca en localStorage:', err);
    }
    return clean;
  }

  function loadCustomGames(baseGames = []) {
    try {
      const raw = localStorage.getItem(CUSTOM_DB_KEY);
      if (raw === null) {
        const migrated = migrateLegacyDeltaIfPresent(baseGames);
        if (migrated) {
          return saveCustomGames(migrated);
        }
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return sortGames(
        parsed
          .filter((item) => item && (item.esName || item.originalName))
          .map((item) => normalizeGame(item, { isCustom: true }))
      );
    } catch {
      return [];
    }
  }

  function upsertCustomGame(gameInput, currentCustomGames) {
    const list = Array.isArray(currentCustomGames) ? [...currentCustomGames] : [];
    let id = gameInput.id ? String(gameInput.id) : slugify(gameInput.esName);

    if (!gameInput.id) {
      const existingIds = new Set(list.map((g) => g.id));
      let suffix = 2;
      const baseId = id;
      while (existingIds.has(id)) {
        id = `${baseId}-${suffix++}`;
      }
    }

    const normalized = normalizeGame({ ...gameInput, id }, { isCustom: true });
    const idx = list.findIndex((g) => g.id === id);
    if (idx >= 0) {
      list[idx] = normalized;
    } else {
      list.push(normalized);
    }

    return saveCustomGames(list);
  }

  function deleteCustomGame(id, currentCustomGames) {
    const filtered = (currentCustomGames || []).filter((g) => g.id !== id);
    return saveCustomGames(filtered);
  }

  function clearCustomGames() {
    return saveCustomGames([]);
  }

  function copyOfficialToCustom(baseGames) {
    return saveCustomGames(baseGames.map((g) => ({ ...g })));
  }

  function importCustomGames(rawArray) {
    if (!Array.isArray(rawArray)) {
      throw new Error('El archivo JSON debe contener un listado (array) de juegos.');
    }
    const validItems = rawArray.filter((item) => item && (item.esName || item.originalName));
    if (validItems.length === 0) {
      throw new Error('No se encontraron juegos válidos en el archivo importado.');
    }

    const usedIds = new Set();
    const imported = validItems.map((item) => {
      let id = item.id ? String(item.id) : slugify(item.esName || item.originalName);
      const baseId = id;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${baseId}-${suffix++}`;
      }
      usedIds.add(id);
      return normalizeGame({ ...item, id }, { isCustom: true });
    });

    return saveCustomGames(imported);
  }

  function serializeForExport(games) {
    const clean = games.map((g) => ({
      id: g.id,
      originalName: g.originalName,
      esName: g.esName,
      ...(g.bggUrl ? { bggUrl: g.bggUrl } : {}),
      ...(g.coverUrl ? { coverUrl: g.coverUrl } : {}),
      min: g.min,
      max: g.max,
      minTime: g.minTime,
      maxTime: g.maxTime,
      complexity: g.complexity,
      mode: g.mode,
      tags: g.tags,
      description: g.description
    }));
    return JSON.stringify(clean, null, 2);
  }

  function getActiveSource() {
    try {
      return localStorage.getItem(ACTIVE_SOURCE_KEY) === 'custom' ? 'custom' : 'official';
    } catch {
      return 'official';
    }
  }

  function saveActiveSource(source) {
    try {
      localStorage.setItem(ACTIVE_SOURCE_KEY, source === 'custom' ? 'custom' : 'official');
    } catch {
      // ignore
    }
  }

  function getSavedTheme() {
    try {
      return localStorage.getItem(THEME_KEY) || 'dark';
    } catch {
      return 'dark';
    }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }

  window.LudotecaStorage = {
    fetchBaseGames,
    loadCustomGames,
    saveCustomGames,
    upsertCustomGame,
    deleteCustomGame,
    clearCustomGames,
    copyOfficialToCustom,
    importCustomGames,
    serializeForExport,
    getActiveSource,
    saveActiveSource,
    getSavedTheme,
    saveTheme
  };
})();
