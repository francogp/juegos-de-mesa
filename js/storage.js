/**
 * Ludoteca · Capa de Datos y Persistencia
 * Combina data/games.json del repositorio con ediciones locales en localStorage
 * mediante un sistema de diferencias (upserts + eliminados) para no perder
 * futuras actualizaciones del repositorio en GitHub Pages.
 */
(function () {
  const STORAGE_KEY = 'ludoteca_custom_delta_v1';
  const THEME_KEY = 'ludoteca_theme_v1';

  function slugify(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || ('juego-' + Date.now());
  }

  function normalizeGame(raw) {
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

    return {
      id: String(raw.id || slugify(esName)),
      esName,
      originalName,
      ...(bggUrl ? { bggUrl } : {}),
      min,
      max,
      minTime,
      maxTime,
      complexity,
      mode,
      tags: tags.slice(0, 5),
      description: String(raw.description || '').trim(),
      isCustom: Boolean(raw.isCustom)
    };
  }

  function readDelta() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { upserts: {}, deletedIds: [] };
      const parsed = JSON.parse(raw);
      return {
        upserts: parsed && typeof parsed.upserts === 'object' ? parsed.upserts : {},
        deletedIds: Array.isArray(parsed && parsed.deletedIds) ? parsed.deletedIds : []
      };
    } catch {
      return { upserts: {}, deletedIds: [] };
    }
  }

  function writeDelta(delta) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(delta));
    } catch (err) {
      console.warn('No se pudo guardar en localStorage:', err);
    }
  }

  async function fetchBaseGames() {
    try {
      const response = await fetch('./data/games.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.map((g) => normalizeGame({ ...g, isCustom: false }));
      }
    } catch {
      // Fallback para protocolo file:// o sin red previa al Service Worker
    }
    const fallback = Array.isArray(window.DEFAULT_GAMES) ? window.DEFAULT_GAMES : [];
    return fallback.map((g) => normalizeGame({ ...g, isCustom: false }));
  }

  function mergeGames(baseGames, delta) {
    const deletedSet = new Set(delta.deletedIds || []);
    const map = new Map();

    for (const base of baseGames) {
      if (!deletedSet.has(base.id)) {
        map.set(base.id, { ...base, isCustom: false });
      }
    }

    for (const [id, customRaw] of Object.entries(delta.upserts || {})) {
      if (deletedSet.has(id)) continue;
      const hadBase = baseGames.some((b) => b.id === id);
      map.set(id, {
        ...normalizeGame(customRaw),
        id,
        isCustom: !hadBase,
        isEdited: hadBase
      });
    }

    return Array.from(map.values()).sort((a, b) =>
      a.esName.localeCompare(b.esName, 'es', { sensitivity: 'base' })
    );
  }

  function hasCustomChanges() {
    const delta = readDelta();
    return Object.keys(delta.upserts).length > 0 || delta.deletedIds.length > 0;
  }

  function upsertGame(gameInput, baseGames) {
    const delta = readDelta();
    let id = gameInput.id ? String(gameInput.id) : slugify(gameInput.esName);

    // Evitar colisiones al crear un juego nuevo
    if (!gameInput.id) {
      const existingIds = new Set([
        ...baseGames.map((g) => g.id),
        ...Object.keys(delta.upserts)
      ]);
      let suffix = 2;
      const baseId = id;
      while (existingIds.has(id) && !delta.deletedIds.includes(id)) {
        id = `${baseId}-${suffix++}`;
      }
    }

    delta.deletedIds = delta.deletedIds.filter((delId) => delId !== id);
    delta.upserts[id] = normalizeGame({ ...gameInput, id });
    writeDelta(delta);
    return mergeGames(baseGames, delta);
  }

  function deleteGame(id, baseGames) {
    const delta = readDelta();
    delete delta.upserts[id];
    if (baseGames.some((b) => b.id === id) && !delta.deletedIds.includes(id)) {
      delta.deletedIds.push(id);
    }
    writeDelta(delta);
    return mergeGames(baseGames, delta);
  }

  function resetCustomChanges(baseGames) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return mergeGames(baseGames, { upserts: {}, deletedIds: [] });
  }

  function importGamesList(rawArray, baseGames) {
    if (!Array.isArray(rawArray)) {
      throw new Error('El archivo JSON debe contener un listado (array) de juegos.');
    }
    const imported = rawArray
      .filter((item) => item && (item.esName || item.originalName))
      .map((item) => normalizeGame(item));

    if (imported.length === 0) {
      throw new Error('No se encontraron juegos válidos en el archivo importado.');
    }

    const importedIds = new Set(imported.map((g) => g.id));
    const deletedIds = baseGames
      .filter((b) => !importedIds.has(b.id))
      .map((b) => b.id);

    const upserts = {};
    for (const game of imported) {
      upserts[game.id] = game;
    }

    const delta = { upserts, deletedIds };
    writeDelta(delta);
    return mergeGames(baseGames, delta);
  }

  function serializeForExport(games) {
    const clean = games.map((g) => ({
      id: g.id,
      originalName: g.originalName,
      esName: g.esName,
      ...(g.bggUrl ? { bggUrl: g.bggUrl } : {}),
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
    readDelta,
    mergeGames,
    hasCustomChanges,
    upsertGame,
    deleteGame,
    resetCustomChanges,
    importGamesList,
    serializeForExport,
    getSavedTheme,
    saveTheme
  };
})();
