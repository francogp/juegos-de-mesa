/**
 * Ludoteca · Lógica Principal de Interfaz, Sorteo, Catálogo y PWA
 * Soporta dos bases independientes:
 * - 'official': Base Oficial del repositorio (solo lectura)
 * - 'custom': Mi Ludoteca personalizada en localStorage (lectura/escritura completa)
 */
(function () {
  const state = {
    baseGames: [],
    customGames: [],
    activeSource: 'official', // 'official' | 'custom'
    games: [],
    activeTab: 'picker', // 'picker' | 'collection'
    picker: {
      players: null, // null = cualquiera, número >= 1
      duration: 'all', // 'all' | 'short' (<=45) | 'medium' (45-90) | 'long' (>=90)
      complexity: 'all', // 'all' | 'ligero' | 'medio' | 'experto'
      mode: 'all', // 'all' | 'competitivo' | 'cooperativo'
      discardedIds: new Set(),
      selectedGame: null,
      isRolling: false
    },
    catalog: {
      query: '',
      players: '',
      duration: 'all',
      complexity: 'all',
      sort: 'name-asc'
    },
    deferredInstallPrompt: null
  };

  const COMPLEXITY_LABELS = {
    ligero: 'Ligero',
    medio: 'Medio',
    experto: 'Experto'
  };

  const COMPLEXITY_ORDER = {
    ligero: 1,
    medio: 2,
    experto: 3
  };

  const MODE_LABELS = {
    competitivo: 'Competitivo',
    cooperativo: 'Cooperativo',
    ambos: 'Coop / Versus'
  };

  function matchesDuration(game, bucket) {
    if (!bucket || bucket === 'all') return true;
    const avg = (game.minTime + game.maxTime) / 2;
    if (bucket === 'short') return game.maxTime <= 50 || avg <= 45;
    if (bucket === 'medium') return avg > 40 && avg <= 95;
    if (bucket === 'long') return game.maxTime >= 90 || avg > 90;
    return true;
  }

  function matchesMode(game, filterMode) {
    if (!filterMode || filterMode === 'all') return true;
    if (game.mode === 'ambos') return true;
    return game.mode === filterMode;
  }

  function formatPlayers(game) {
    return game.min === game.max ? `${game.min}` : `${game.min}–${game.max}`;
  }

  function formatTime(game) {
    return game.minTime === game.maxTime
      ? `${game.minTime} min`
      : `${game.minTime}–${game.maxTime} min`;
  }

  function buildBggSleevesUrl(bggUrl) {
    if (!bggUrl) return '';
    try {
      const url = new URL(bggUrl);
      if (!/(^|\.)boardgamegeek\.com$/i.test(url.hostname)) return '';
      if (!/^\/boardgame\/\d+/i.test(url.pathname)) return '';
      const cleanPath = url.pathname.replace(/\/+$/, '').replace(/\/sleeves$/i, '');
      url.pathname = `${cleanPath}/sleeves`;
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      return '';
    }
  }

  function buildExternalLinks(game) {
    const safeOrig = encodeURIComponent(game.originalName);
    const safeEs = encodeURIComponent(game.esName);
    return {
      bgg:
        game.bggUrl ||
        `https://boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q=${safeOrig}`,
      sleeves: buildBggSleevesUrl(game.bggUrl),
      images: `https://www.google.com/search?tbm=isch&q=${safeOrig}%20board%20game`,
      youtube: `https://www.youtube.com/results?search_query=como+jugar+${safeEs}+juego+de+mesa`
    };
  }

  function showToast(message) {
    const region = document.getElementById('toastRegion');
    if (!region) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    region.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3200);
  }

  function getBaseAppUrl() {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Usar respaldo con textarea si falla el permiso
      }
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  let copyBtnResetTimer = null;
  async function handleCopyAppLink() {
    const shareUrl = getBaseAppUrl();
    const ok = await copyTextToClipboard(shareUrl);
    if (!ok) {
      showToast('No se pudo copiar automáticamente: ' + shareUrl);
      return;
    }

    const btn = document.getElementById('copyLinkBtn');
    const icon = document.getElementById('copyLinkIcon');
    const check = document.getElementById('copyLinkCheck');
    const label = document.getElementById('copyLinkLabel');

    btn.classList.add('is-copied');
    icon.style.display = 'none';
    check.style.display = 'block';
    label.textContent = '¡Copiado!';
    showToast('✓ ¡Link copiado al portapapeles!');

    if (copyBtnResetTimer) clearTimeout(copyBtnResetTimer);
    copyBtnResetTimer = setTimeout(() => {
      btn.classList.remove('is-copied');
      icon.style.display = 'block';
      check.style.display = 'none';
      label.textContent = 'Compartir link';
    }, 2400);
  }

  let shareWinnerResetTimer = null;
  async function handleShareWinnerGame() {
    const game = state.picker.selectedGame;
    if (!game) return;

    const url = new URL(getBaseAppUrl());
    url.searchParams.set('juego', game.id);
    const shareUrl = url.toString();

    const ok = await copyTextToClipboard(shareUrl);
    if (!ok) {
      showToast('No se pudo copiar automáticamente: ' + shareUrl);
      return;
    }

    const label = document.getElementById('shareWinnerLabel');
    label.textContent = '¡Copiado!';
    showToast(`✓ ¡Link de «${game.esName}» copiado!`);

    if (shareWinnerResetTimer) clearTimeout(shareWinnerResetTimer);
    shareWinnerResetTimer = setTimeout(() => {
      label.textContent = 'Copiar link del juego';
    }, 2400);
  }

  // =========================================================================
  // TEMA CLARO / OSCURO
  // =========================================================================
  function applyTheme(theme) {
    const cleanTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cleanTheme);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', cleanTheme === 'light' ? '#f5f0e8' : '#141210');
    }
    const label = document.getElementById('themeBtnLabel');
    const iconDark = document.getElementById('themeIconMoon');
    const iconLight = document.getElementById('themeIconSun');
    if (label) {
      label.textContent = cleanTheme === 'dark' ? 'Modo claro' : 'Modo oscuro';
    }
    if (iconDark && iconLight) {
      iconDark.style.display = cleanTheme === 'dark' ? 'none' : 'block';
      iconLight.style.display = cleanTheme === 'dark' ? 'block' : 'none';
    }
    window.LudotecaStorage.saveTheme(cleanTheme);
  }

  // =========================================================================
  // FUENTE DE DATOS (OFICIAL VS MI LUDOTECA) Y PESTAÑAS
  // =========================================================================
  function syncSourceUI() {
    const isOfficial = state.activeSource === 'official';
    state.games = isOfficial ? state.baseGames : state.customGames;

    document.getElementById('sourceBtnOfficial').setAttribute('aria-pressed', String(isOfficial));
    document.getElementById('sourceBtnCustom').setAttribute('aria-pressed', String(!isOfficial));

    document.getElementById('officialCountBadge').textContent = String(state.baseGames.length);
    document.getElementById('customCountBadge').textContent = String(state.customGames.length);

    document.getElementById('openAddGameBtn').hidden = isOfficial;

    document.getElementById('collectionTabCount').textContent = String(state.games.length);
    document.getElementById('footerSourceLabel').textContent = isOfficial
      ? 'Base Oficial'
      : 'Mi Ludoteca';
    document.getElementById('footerTotalCount').textContent = String(state.games.length);
  }

  function switchDatabaseSource(source) {
    const next = source === 'custom' ? 'custom' : 'official';
    if (state.activeSource === next) return;

    state.activeSource = next;
    window.LudotecaStorage.saveActiveSource(next);
    state.picker.discardedIds.clear();
    state.picker.selectedGame = null;
    setPickerError('');

    refreshCollectionCounts();
    renderStage();
  }

  function switchTab(tabName) {
    state.activeTab = tabName === 'collection' ? 'collection' : 'picker';
    const tabPicker = document.getElementById('tabBtnPicker');
    const tabCollection = document.getElementById('tabBtnCollection');
    const viewPicker = document.getElementById('viewPicker');
    const viewCollection = document.getElementById('viewCollection');

    const isPicker = state.activeTab === 'picker';
    tabPicker.setAttribute('aria-selected', String(isPicker));
    tabCollection.setAttribute('aria-selected', String(!isPicker));
    viewPicker.hidden = !isPicker;
    viewCollection.hidden = isPicker;

    if (!isPicker) {
      renderCatalog();
    }
  }

  // =========================================================================
  // LÓGICA DEL SORTEO
  // =========================================================================
  function getMatchingPickerGames(excludeDiscarded = true) {
    const p = state.picker;
    return state.games.filter((game) => {
      if (p.players !== null && (p.players < game.min || p.players > game.max)) {
        return false;
      }
      if (!matchesDuration(game, p.duration)) return false;
      if (p.complexity !== 'all' && game.complexity !== p.complexity) return false;
      if (!matchesMode(game, p.mode)) return false;
      if (excludeDiscarded && p.discardedIds.has(game.id)) return false;
      return true;
    });
  }

  function syncPlayerControls() {
    const input = document.getElementById('playerCountInput');
    const hint = document.getElementById('playerRangeHint');
    const val = state.picker.players;

    if (document.activeElement !== input) {
      input.value = val === null ? '' : String(val);
    }

    hint.textContent =
      val === null ? 'Sin límite de jugadores' : `${val} ${val === 1 ? 'jugador' : 'jugadores'}`;

    document.querySelectorAll('[data-player-quick]').forEach((btn) => {
      const target = btn.getAttribute('data-player-quick');
      const isPressed =
        (target === 'any' && val === null) ||
        (target !== 'any' && Number(target) === val);
      btn.setAttribute('aria-pressed', String(isPressed));
    });
  }

  function updatePickerPoolUI() {
    const statusText = document.getElementById('poolStatusText');
    const resetDiscardsBtn = document.getElementById('resetDiscardsBtn');
    const rollBtn = document.getElementById('rollGameBtn');
    const emptyDesc = document.getElementById('stageEmptySummary');

    if (state.activeSource === 'custom' && state.games.length === 0) {
      statusText.innerHTML = 'Tu ludoteca personalizada está vacía';
      resetDiscardsBtn.hidden = true;
      rollBtn.disabled = true;
      return;
    }

    const allCompatible = getMatchingPickerGames(false);
    const available = getMatchingPickerGames(true);
    const discardedCount = allCompatible.length - available.length;

    if (allCompatible.length === 0) {
      statusText.innerHTML = '<strong>0</strong> juegos coinciden con estos filtros';
    } else if (discardedCount > 0) {
      statusText.innerHTML = `<strong>${available.length}</strong> disponibles de ${allCompatible.length} (${discardedCount} descartados)`;
    } else {
      statusText.innerHTML = `<strong>${allCompatible.length}</strong> ${allCompatible.length === 1 ? 'juego compatible' : 'juegos compatibles'}`;
    }

    resetDiscardsBtn.hidden = discardedCount === 0;
    rollBtn.disabled = allCompatible.length === 0 || state.picker.isRolling;

    if (emptyDesc) {
      const label = state.activeSource === 'official' ? 'la Base Oficial' : 'Mi Ludoteca';
      emptyDesc.textContent =
        allCompatible.length > 0
          ? `Hay ${allCompatible.length} opciones listas en ${label} para los criterios actuales.`
          : 'Prueba ampliando la cantidad de jugadores, duración o complejidad.';
    }
  }

  function setPickerError(msg) {
    const err = document.getElementById('pickerError');
    if (!msg) {
      err.hidden = true;
      err.textContent = '';
    } else {
      err.hidden = false;
      err.textContent = msg;
    }
  }

  function renderStage() {
    const emptyEl = document.getElementById('stageEmpty');
    const onboardEl = document.getElementById('stageCustomOnboarding');
    const rollingEl = document.getElementById('stageRolling');
    const winnerEl = document.getElementById('stageWinner');

    emptyEl.hidden = true;
    onboardEl.hidden = true;
    rollingEl.hidden = true;
    winnerEl.hidden = true;

    if (state.picker.isRolling) {
      rollingEl.hidden = false;
      return;
    }

    const game = state.picker.selectedGame;
    if (!game) {
      if (state.activeSource === 'custom' && state.games.length === 0) {
        onboardEl.hidden = false;
      } else {
        emptyEl.hidden = false;
      }
      return;
    }

    winnerEl.hidden = false;
    const links = buildExternalLinks(game);

    const coverFrame = document.getElementById('winnerCoverFrame');
    const coverImg = document.getElementById('winnerCoverImg');
    const coverLink = document.getElementById('winnerCoverLink');
    if (game.coverUrl) {
      coverFrame.hidden = false;
      coverLink.href = links.bgg;
      coverImg.alt = `Caja oficial de ${game.esName}`;
      coverImg.onerror = () => {
        coverFrame.hidden = true;
      };
      coverImg.src = game.coverUrl;
    } else {
      coverFrame.hidden = true;
      coverImg.removeAttribute('src');
    }

    document.getElementById('winnerTitle').textContent = game.esName;
    const sub = document.getElementById('winnerSubtitle');
    if (game.originalName && game.originalName.toLowerCase() !== game.esName.toLowerCase()) {
      sub.textContent = game.originalName;
      sub.hidden = false;
    } else {
      sub.hidden = true;
    }

    const badge = document.getElementById('winnerComplexity');
    badge.className = `complexity-badge complexity-${game.complexity}`;
    badge.textContent = COMPLEXITY_LABELS[game.complexity] || 'Medio';

    document.getElementById('winnerPlayers').textContent = `${formatPlayers(game)} jug.`;
    document.getElementById('winnerTime').textContent = formatTime(game);
    document.getElementById('winnerMode').textContent = MODE_LABELS[game.mode] || 'Competitivo';
    document.getElementById('winnerDescription').textContent =
      game.description || 'Una gran opción de la ludoteca para llevar hoy a la mesa.';

    const tagsContainer = document.getElementById('winnerTags');
    tagsContainer.innerHTML = '';
    (game.tags || []).forEach((tag) => {
      const span = document.createElement('span');
      span.className = 'tag-chip';
      span.textContent = tag;
      tagsContainer.appendChild(span);
    });

    document.getElementById('winnerLinkBgg').href = links.bgg;
    const sleevesLinkEl = document.getElementById('winnerLinkSleeves');
    if (sleevesLinkEl) {
      sleevesLinkEl.href = links.sleeves || '#';
      sleevesLinkEl.hidden = !links.sleeves;
    }
    document.getElementById('winnerLinkImages').href = links.images;
    document.getElementById('winnerLinkYoutube').href = links.youtube;

    // Mostrar "Copiar link del juego" solo si existe en la Base Oficial pública
    const isInOfficial = state.baseGames.some((b) => b.id === game.id);
    document.getElementById('shareWinnerBtn').hidden = !isInOfficial;

    const remainingOthers = getMatchingPickerGames(true).filter((g) => g.id !== game.id);
    const rerollInfo = document.getElementById('rerollRemainingInfo');
    const rerollBtn = document.getElementById('rerollSkipBtn');

    if (remainingOthers.length > 0) {
      rerollInfo.textContent = `Quedan ${remainingOthers.length} ${remainingOthers.length === 1 ? 'alternativa' : 'alternativas'} sin repetir.`;
      rerollBtn.textContent = 'Probar otro (descartar este)';
      rerollBtn.disabled = false;
    } else {
      const totalCompatible = getMatchingPickerGames(false).length;
      if (totalCompatible <= 1) {
        rerollInfo.textContent = 'Es el único juego que coincide con estos filtros.';
        rerollBtn.disabled = true;
      } else {
        rerollInfo.textContent = 'Ya viste todas las opciones compatibles de esta ronda.';
        rerollBtn.textContent = 'Reiniciar ronda y volver a sortear';
        rerollBtn.disabled = false;
      }
    }
  }

  function runDraw({ discardCurrent = false } = {}) {
    if (state.picker.isRolling) return;
    setPickerError('');

    const allCompatible = getMatchingPickerGames(false);
    if (allCompatible.length === 0) {
      setPickerError('No hay juegos que coincidan con los filtros seleccionados.');
      return;
    }

    if (discardCurrent && state.picker.selectedGame) {
      state.picker.discardedIds.add(state.picker.selectedGame.id);
    }

    let pool = getMatchingPickerGames(true);
    if (pool.length === 0) {
      state.picker.discardedIds.clear();
      pool = getMatchingPickerGames(true);
      showToast('Se reiniciaron los descartes para una nueva ronda.');
    }

    const chosen = pool[Math.floor(Math.random() * pool.length)];
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const stagePanel = document.querySelector('.stage-panel');
    if (stagePanel && window.innerWidth <= 860) {
      stagePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (prefersReducedMotion || pool.length === 1) {
      state.picker.selectedGame = chosen;
      updatePickerPoolUI();
      renderStage();
      return;
    }

    state.picker.isRolling = true;
    updatePickerPoolUI();
    renderStage();

    const rollingTitleEl = document.getElementById('rollingCandidateTitle');
    let ticks = 0;
    const totalTicks = 9;

    const timer = setInterval(() => {
      const sample = allCompatible[Math.floor(Math.random() * allCompatible.length)];
      rollingTitleEl.textContent = sample.esName;
      ticks += 1;
      if (ticks >= totalTicks) {
        clearInterval(timer);
        state.picker.isRolling = false;
        state.picker.selectedGame = chosen;
        updatePickerPoolUI();
        renderStage();
      }
    }, 60);
  }

  // =========================================================================
  // CATÁLOGO / COLECCIÓN COMPLETA
  // =========================================================================
  function getFilteredCatalogGames() {
    const c = state.catalog;
    const q = c.query.trim().toLowerCase();
    const playersNum = parseInt(c.players, 10);
    const hasPlayerFilter = !isNaN(playersNum) && playersNum >= 1;

    const filtered = state.games.filter((game) => {
      if (q) {
        const inEs = game.esName.toLowerCase().includes(q);
        const inOrig = game.originalName.toLowerCase().includes(q);
        const inTags = (game.tags || []).some((t) => t.toLowerCase().includes(q));
        const inDesc = (game.description || '').toLowerCase().includes(q);
        if (!inEs && !inOrig && !inTags && !inDesc) return false;
      }
      if (hasPlayerFilter && (playersNum < game.min || playersNum > game.max)) {
        return false;
      }
      if (!matchesDuration(game, c.duration)) return false;
      if (c.complexity !== 'all' && game.complexity !== c.complexity) return false;
      return true;
    });

    filtered.sort((a, b) => {
      switch (c.sort) {
        case 'time-asc':
          return (a.minTime + a.maxTime) / 2 - (b.minTime + b.maxTime) / 2;
        case 'time-desc':
          return (b.minTime + b.maxTime) / 2 - (a.minTime + a.maxTime) / 2;
        case 'complexity-asc':
          return (COMPLEXITY_ORDER[a.complexity] || 2) - (COMPLEXITY_ORDER[b.complexity] || 2);
        case 'complexity-desc':
          return (COMPLEXITY_ORDER[b.complexity] || 2) - (COMPLEXITY_ORDER[a.complexity] || 2);
        case 'name-asc':
        default:
          return a.esName.localeCompare(b.esName, 'es', { sensitivity: 'base' });
      }
    });

    return filtered;
  }

  function renderCatalog() {
    const grid = document.getElementById('catalogGrid');
    const summary = document.getElementById('catalogResultsSummary');
    const isCustom = state.activeSource === 'custom';

    document.getElementById('exportJsonBtn').hidden = state.games.length === 0;
    document.getElementById('importJsonBtn').hidden = !isCustom;
    document.getElementById('copyOfficialBtn').hidden = !isCustom;
    document.getElementById('clearCustomBtn').hidden = !isCustom || state.customGames.length === 0;

    grid.innerHTML = '';

    if (isCustom && state.games.length === 0) {
      summary.textContent = 'Mi Ludoteca está vacía';
      const emptyCustom = document.createElement('div');
      emptyCustom.className = 'empty-catalog';
      emptyCustom.innerHTML = `
        <h3>Empezá a armar tu ludoteca personalizada</h3>
        <p>Podés agregar tus juegos uno por uno, importar tu propio archivo JSON o copiar los ${state.baseGames.length} juegos de la Base Oficial para editarlos libremente.</p>
        <div class="onboarding-actions">
          <button type="button" class="btn btn-primary btn-sm" data-empty-action="add">+ Agregar primer juego</button>
          <button type="button" class="btn btn-secondary btn-sm" data-empty-action="copy">📋 Copiar Base Oficial (${state.baseGames.length})</button>
          <button type="button" class="btn btn-ghost btn-sm" data-empty-action="import">📥 Importar JSON</button>
        </div>
      `;
      emptyCustom
        .querySelector('[data-empty-action="add"]')
        .addEventListener('click', () => openGameDialog(null));
      emptyCustom
        .querySelector('[data-empty-action="copy"]')
        .addEventListener('click', handleCopyOfficialToCustom);
      emptyCustom
        .querySelector('[data-empty-action="import"]')
        .addEventListener('click', () => document.getElementById('importJsonInput').click());
      grid.appendChild(emptyCustom);
      return;
    }

    const list = getFilteredCatalogGames();
    const sourceLabel = isCustom ? 'Mi Ludoteca' : 'la Base Oficial';
    summary.textContent =
      list.length === state.games.length
        ? `Mostrando los ${state.games.length} juegos de ${sourceLabel}`
        : `Mostrando ${list.length} de ${state.games.length} juegos de ${sourceLabel}`;

    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-catalog';
      empty.innerHTML = `
        <h3>Sin coincidencias</h3>
        <p>No encontramos ningún juego con esos criterios de búsqueda.</p>
      `;
      grid.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    list.forEach((game) => {
      const card = document.createElement('article');
      card.className = 'game-card';

      const links = buildExternalLinks(game);
      const showOrig =
        game.originalName && game.originalName.toLowerCase() !== game.esName.toLowerCase();

      const topDiv = document.createElement('div');
      topDiv.innerHTML = `
        <div class="game-card-header">
          <div class="game-card-brand">
            ${game.coverUrl ? '<img class="game-card-thumb" alt="" loading="lazy" referrerpolicy="no-referrer">' : ''}
            <div>
              <h3 class="game-card-title"></h3>
              ${showOrig ? '<p class="game-card-orig"></p>' : ''}
            </div>
          </div>
          <span class="complexity-badge complexity-${game.complexity}">${COMPLEXITY_LABELS[game.complexity] || 'Medio'}</span>
        </div>
        <div class="game-card-stats">
          <span title="Jugadores">👥 ${formatPlayers(game)} jug.</span>
          <span title="Duración estimada">⏱️ ${formatTime(game)}</span>
          <span title="Modo de juego">🎯 ${MODE_LABELS[game.mode] || 'Competitivo'}</span>
        </div>
        <p class="game-card-desc"></p>
      `;

      if (game.coverUrl) {
        const thumb = topDiv.querySelector('.game-card-thumb');
        thumb.src = game.coverUrl;
        thumb.alt = `Portada de ${game.esName}`;
        thumb.onerror = () => thumb.remove();
      }
      topDiv.querySelector('.game-card-title').textContent = game.esName;
      if (showOrig) {
        topDiv.querySelector('.game-card-orig').textContent = game.originalName;
      }
      topDiv.querySelector('.game-card-desc').textContent =
        game.description || 'Juego de mesa de la colección.';

      const bottomDiv = document.createElement('div');
      bottomDiv.className = 'game-card-footer';

      const tagList = document.createElement('div');
      tagList.className = 'tag-list';
      (game.tags || []).forEach((t) => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = t;
        tagList.appendChild(chip);
      });
      if ((game.tags || []).length > 0) {
        bottomDiv.appendChild(tagList);
      }

      const actionsRow = document.createElement('div');
      actionsRow.className = 'card-actions-row';

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'mini-btn';
      selectBtn.textContent = 'Llevar a mesa';
      selectBtn.addEventListener('click', () => {
        state.picker.selectedGame = game;
        switchTab('picker');
        renderStage();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      const miniLinks = document.createElement('div');
      miniLinks.className = 'card-mini-links';

      const bggLink = document.createElement('a');
      bggLink.className = 'mini-btn';
      bggLink.href = links.bgg;
      bggLink.target = '_blank';
      bggLink.rel = 'noopener noreferrer';
      bggLink.textContent = 'BGG ↗';
      miniLinks.appendChild(bggLink);

      if (links.sleeves) {
        const sleevesLink = document.createElement('a');
        sleevesLink.className = 'mini-btn';
        sleevesLink.href = links.sleeves;
        sleevesLink.target = '_blank';
        sleevesLink.rel = 'noopener noreferrer';
        sleevesLink.title = 'Ver tamaño y cantidad de fundas (sleeves) en BGG';
        sleevesLink.textContent = 'Sleeves ↗';
        miniLinks.appendChild(sleevesLink);
      }

      // Solo permitir Editar y Quitar dentro de Mi Ludoteca personalizada
      if (isCustom) {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'mini-btn';
        editBtn.textContent = 'Editar';
        editBtn.addEventListener('click', () => openGameDialog(game));

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'mini-btn mini-btn-danger';
        removeBtn.textContent = 'Quitar';
        removeBtn.addEventListener('click', () => handleQuickRemoveCustomGame(game));

        miniLinks.appendChild(editBtn);
        miniLinks.appendChild(removeBtn);
      }

      actionsRow.appendChild(selectBtn);
      actionsRow.appendChild(miniLinks);
      bottomDiv.appendChild(actionsRow);

      card.appendChild(topDiv);
      card.appendChild(bottomDiv);
      fragment.appendChild(card);
    });

    grid.appendChild(fragment);
  }

  function refreshCollectionCounts() {
    syncSourceUI();
    updatePickerPoolUI();
    if (state.activeTab === 'collection') {
      renderCatalog();
    }
  }

  // =========================================================================
  // MODAL AGREGAR / EDITAR JUEGO (SOLO MI LUDOTECA)
  // =========================================================================
  function openGameDialog(gameToEdit = null) {
    if (state.activeSource !== 'custom') return;

    const dialog = document.getElementById('gameFormDialog');
    const title = document.getElementById('gameDialogTitle');
    const deleteBtn = document.getElementById('deleteGameBtn');
    const form = document.getElementById('gameForm');

    form.reset();
    document.getElementById('formGameId').value = gameToEdit ? gameToEdit.id : '';

    if (gameToEdit) {
      title.textContent = 'Editar juego de Mi Ludoteca';
      document.getElementById('formEsName').value = gameToEdit.esName;
      document.getElementById('formOrigName').value = gameToEdit.originalName;
      document.getElementById('formMinPlayers').value = gameToEdit.min;
      document.getElementById('formMaxPlayers').value = gameToEdit.max;
      document.getElementById('formMinTime').value = gameToEdit.minTime;
      document.getElementById('formMaxTime').value = gameToEdit.maxTime;
      document.getElementById('formComplexity').value = gameToEdit.complexity;
      document.getElementById('formMode').value = gameToEdit.mode;
      document.getElementById('formCoverUrl').value = gameToEdit.coverUrl || '';
      document.getElementById('formTags').value = (gameToEdit.tags || []).join(', ');
      document.getElementById('formDescription').value = gameToEdit.description || '';
      deleteBtn.hidden = false;
    } else {
      title.textContent = 'Agregar juego a Mi Ludoteca';
      document.getElementById('formMinPlayers').value = 2;
      document.getElementById('formMaxPlayers').value = 4;
      document.getElementById('formMinTime').value = 30;
      document.getElementById('formMaxTime').value = 60;
      document.getElementById('formComplexity').value = 'medio';
      document.getElementById('formMode').value = 'competitivo';
      document.getElementById('formCoverUrl').value = '';
      deleteBtn.hidden = true;
    }

    dialog.showModal();
  }

  function handleSaveGameForm(event) {
    event.preventDefault();
    if (state.activeSource !== 'custom') return;

    const id = document.getElementById('formGameId').value.trim();
    const existing = id ? state.customGames.find((g) => g.id === id) : null;
    const esName = document.getElementById('formEsName').value.trim();
    const originalName = document.getElementById('formOrigName').value.trim() || esName;
    const min = parseInt(document.getElementById('formMinPlayers').value, 10) || 1;
    const max = parseInt(document.getElementById('formMaxPlayers').value, 10) || min;
    const minTime = parseInt(document.getElementById('formMinTime').value, 10) || 30;
    const maxTime = parseInt(document.getElementById('formMaxTime').value, 10) || minTime;
    const complexity = document.getElementById('formComplexity').value;
    const mode = document.getElementById('formMode').value;
    const coverUrl = document.getElementById('formCoverUrl').value.trim();
    const tags = document.getElementById('formTags').value;
    const description = document.getElementById('formDescription').value.trim();

    if (!esName) return;

    state.customGames = window.LudotecaStorage.upsertCustomGame(
      {
        id: id || undefined,
        esName,
        originalName,
        bggUrl: existing && existing.bggUrl ? existing.bggUrl : undefined,
        coverUrl: coverUrl || undefined,
        min: Math.min(min, max),
        max: Math.max(min, max),
        minTime: Math.min(minTime, maxTime),
        maxTime: Math.max(minTime, maxTime),
        complexity,
        mode,
        tags,
        description
      },
      state.customGames
    );

    refreshCollectionCounts();
    if (state.picker.selectedGame && id === state.picker.selectedGame.id) {
      state.picker.selectedGame = state.customGames.find((g) => g.id === id) || null;
    }
    renderStage();

    document.getElementById('gameFormDialog').close();
    showToast(id ? `✓ «${esName}» actualizado.` : `✓ «${esName}» agregado a Mi Ludoteca.`);
  }

  function removeGameFromCustomById(id, name) {
    state.customGames = window.LudotecaStorage.deleteCustomGame(id, state.customGames);
    state.picker.discardedIds.delete(id);
    if (state.picker.selectedGame && state.picker.selectedGame.id === id) {
      state.picker.selectedGame = null;
    }
    refreshCollectionCounts();
    renderStage();
    showToast(`«${name}» quitado de Mi Ludoteca.`);
  }

  function handleQuickRemoveCustomGame(game) {
    if (state.activeSource !== 'custom') return;
    if (!window.confirm(`¿Quitar «${game.esName}» de Mi Ludoteca?`)) return;
    removeGameFromCustomById(game.id, game.esName);
  }

  function handleDeleteCurrentGame() {
    if (state.activeSource !== 'custom') return;
    const id = document.getElementById('formGameId').value.trim();
    if (!id) return;
    const target = state.customGames.find((g) => g.id === id);
    const name = target ? target.esName : 'este juego';
    if (!window.confirm(`¿Quitar «${name}» de Mi Ludoteca?`)) return;

    document.getElementById('gameFormDialog').close();
    removeGameFromCustomById(id, name);
  }

  // =========================================================================
  // IMPORTAR / EXPORTAR / COPIAR OFICIAL / VACIAR MI LUDOTECA
  // =========================================================================
  function exportCollectionJson() {
    if (state.games.length === 0) return;
    const content = window.LudotecaStorage.serializeForExport(state.games);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const filename =
      state.activeSource === 'custom' ? 'mi-ludoteca.json' : 'ludoteca-oficial.json';
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`✓ Archivo ${filename} descargado.`);
  }

  function handleImportFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        state.customGames = window.LudotecaStorage.importCustomGames(parsed);
        state.activeSource = 'custom';
        window.LudotecaStorage.saveActiveSource('custom');
        state.picker.discardedIds.clear();
        state.picker.selectedGame = null;
        refreshCollectionCounts();
        renderStage();
        showToast(`✓ ${state.customGames.length} juegos importados en Mi Ludoteca.`);
      } catch (err) {
        window.alert(err.message || 'No se pudo leer el archivo JSON.');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  }

  function handleCopyOfficialToCustom() {
    if (
      state.customGames.length > 0 &&
      !window.confirm(
        `¿Reemplazar tu lista actual de Mi Ludoteca con una copia de los ${state.baseGames.length} juegos de la Base Oficial?`
      )
    ) {
      return;
    }
    state.customGames = window.LudotecaStorage.copyOfficialToCustom(state.baseGames);
    state.activeSource = 'custom';
    window.LudotecaStorage.saveActiveSource('custom');
    state.picker.discardedIds.clear();
    state.picker.selectedGame = null;
    refreshCollectionCounts();
    renderStage();
    showToast(`✓ Se copiaron ${state.customGames.length} juegos a Mi Ludoteca.`);
  }

  function handleClearCustomList() {
    if (state.activeSource !== 'custom' || state.customGames.length === 0) return;
    if (
      !window.confirm(
        '¿Vaciar todos los juegos de Mi Ludoteca? La Base Oficial no se verá afectada.'
      )
    ) {
      return;
    }
    state.customGames = window.LudotecaStorage.clearCustomGames();
    state.picker.discardedIds.clear();
    state.picker.selectedGame = null;
    refreshCollectionCounts();
    renderStage();
    showToast('Mi Ludoteca quedó vacía.');
  }

  // =========================================================================
  // EVENTOS Y REGISTRO PWA
  // =========================================================================
  function bindEvents() {
    // Compartir enlaces al portapapeles
    document.getElementById('copyLinkBtn').addEventListener('click', handleCopyAppLink);
    document.getElementById('shareWinnerBtn').addEventListener('click', handleShareWinnerGame);

    // Tema
    document.getElementById('themeToggleBtn').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });

    // Selector de Base de Datos (Oficial vs Mi Ludoteca)
    document
      .getElementById('sourceBtnOfficial')
      .addEventListener('click', () => switchDatabaseSource('official'));
    document
      .getElementById('sourceBtnCustom')
      .addEventListener('click', () => switchDatabaseSource('custom'));

    // Pestañas de vista
    document.getElementById('tabBtnPicker').addEventListener('click', () => switchTab('picker'));
    document
      .getElementById('tabBtnCollection')
      .addEventListener('click', () => switchTab('collection'));

    // Botones de alta y onboarding de Mi Ludoteca
    document.getElementById('openAddGameBtn').addEventListener('click', () => openGameDialog(null));
    document.getElementById('onboardAddBtn').addEventListener('click', () => openGameDialog(null));
    document
      .getElementById('onboardCopyOfficialBtn')
      .addEventListener('click', handleCopyOfficialToCustom);
    document.getElementById('onboardImportBtn').addEventListener('click', () => {
      document.getElementById('importJsonInput').click();
    });

    // Chips rápidos de jugadores
    document.querySelectorAll('[data-player-quick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = btn.getAttribute('data-player-quick');
        state.picker.players = raw === 'any' ? null : parseInt(raw, 10);
        state.picker.discardedIds.clear();
        syncPlayerControls();
        updatePickerPoolUI();
        renderStage();
      });
    });

    // Input numérico y steppers de jugadores
    const playerInput = document.getElementById('playerCountInput');
    playerInput.addEventListener('input', () => {
      const val = parseInt(playerInput.value, 10);
      state.picker.players = !isNaN(val) && val >= 1 ? Math.min(val, 50) : null;
      state.picker.discardedIds.clear();
      syncPlayerControls();
      updatePickerPoolUI();
      renderStage();
    });

    playerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runDraw({ discardCurrent: false });
      }
    });

    document.getElementById('playerDecrementBtn').addEventListener('click', () => {
      const curr = state.picker.players;
      if (curr === null || curr <= 1) {
        state.picker.players = curr === 1 ? null : 1;
      } else {
        state.picker.players = curr - 1;
      }
      state.picker.discardedIds.clear();
      syncPlayerControls();
      updatePickerPoolUI();
      renderStage();
    });

    document.getElementById('playerIncrementBtn').addEventListener('click', () => {
      const curr = state.picker.players;
      state.picker.players = curr === null ? 4 : Math.min(50, curr + 1);
      state.picker.discardedIds.clear();
      syncPlayerControls();
      updatePickerPoolUI();
      renderStage();
    });

    // Pastillas de duración, complejidad y modo en Sorteo
    document.querySelectorAll('[data-picker-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const group = btn.getAttribute('data-picker-filter');
        const value = btn.getAttribute('data-value');
        state.picker[group] = value;
        state.picker.discardedIds.clear();

        document.querySelectorAll(`[data-picker-filter="${group}"]`).forEach((peer) => {
          peer.setAttribute('aria-pressed', String(peer === btn));
        });

        updatePickerPoolUI();
        renderStage();
      });
    });

    // Acciones de sorteo
    document.getElementById('rollGameBtn').addEventListener('click', () => {
      runDraw({ discardCurrent: false });
    });

    document.getElementById('rerollSkipBtn').addEventListener('click', () => {
      runDraw({ discardCurrent: true });
    });

    document.getElementById('resetDiscardsBtn').addEventListener('click', () => {
      state.picker.discardedIds.clear();
      updatePickerPoolUI();
      renderStage();
      showToast('Descartes restablecidos.');
    });

    // Filtros del catálogo
    document.getElementById('catalogSearchInput').addEventListener('input', (e) => {
      state.catalog.query = e.target.value;
      renderCatalog();
    });

    document.getElementById('catalogPlayersFilter').addEventListener('input', (e) => {
      state.catalog.players = e.target.value;
      renderCatalog();
    });

    document.getElementById('catalogDurationFilter').addEventListener('change', (e) => {
      state.catalog.duration = e.target.value;
      renderCatalog();
    });

    document.getElementById('catalogComplexityFilter').addEventListener('change', (e) => {
      state.catalog.complexity = e.target.value;
      renderCatalog();
    });

    document.getElementById('catalogSortSelect').addEventListener('change', (e) => {
      state.catalog.sort = e.target.value;
      renderCatalog();
    });

    // Exportar / Importar / Copiar Oficial / Vaciar Mi Ludoteca
    document.getElementById('exportJsonBtn').addEventListener('click', exportCollectionJson);
    document.getElementById('importJsonBtn').addEventListener('click', () => {
      document.getElementById('importJsonInput').click();
    });
    document.getElementById('importJsonInput').addEventListener('change', handleImportFile);
    document.getElementById('copyOfficialBtn').addEventListener('click', handleCopyOfficialToCustom);
    document.getElementById('clearCustomBtn').addEventListener('click', handleClearCustomList);

    // Diálogo CRUD
    const dialog = document.getElementById('gameFormDialog');
    document.getElementById('closeGameDialogBtn').addEventListener('click', () => dialog.close());
    document.getElementById('cancelGameDialogBtn').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    document.getElementById('gameForm').addEventListener('submit', handleSaveGameForm);
    document.getElementById('deleteGameBtn').addEventListener('click', handleDeleteCurrentGame);

    // Instalación PWA
    const installBtn = document.getElementById('installPwaBtn');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredInstallPrompt = e;
      installBtn.hidden = false;
    });

    installBtn.addEventListener('click', async () => {
      if (!state.deferredInstallPrompt) return;
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      installBtn.hidden = true;
    });

    window.addEventListener('appinstalled', () => {
      state.deferredInstallPrompt = null;
      installBtn.hidden = true;
      showToast('Ludoteca instalada en tu dispositivo.');
    });
  }

  function registerServiceWorker() {
    if (
      'serviceWorker' in navigator &&
      (location.protocol === 'https:' ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1')
    ) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('./sw.js')
          .then((reg) => reg.update().catch(() => {}))
          .catch(() => {});
      });
    }
  }

  async function init() {
    applyTheme(window.LudotecaStorage.getSavedTheme());
    bindEvents();
    registerServiceWorker();

    state.baseGames = await window.LudotecaStorage.fetchBaseGames();
    state.customGames = window.LudotecaStorage.loadCustomGames(state.baseGames);
    state.activeSource = window.LudotecaStorage.getActiveSource();

    const sharedGameId = new URLSearchParams(window.location.search).get('juego');
    if (sharedGameId) {
      const inOfficial = state.baseGames.find((g) => g.id === sharedGameId);
      if (inOfficial) {
        state.activeSource = 'official';
        state.picker.selectedGame = inOfficial;
      }
    }

    syncPlayerControls();
    refreshCollectionCounts();
    renderStage();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
