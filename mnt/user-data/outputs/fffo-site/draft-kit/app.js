(() => {
  'use strict';

  const VALID_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'TD'];
  const POSITION_ALIASES = { DST: 'TD', DEF: 'TD', DEFENSE: 'TD', DEFENCE: 'TD' };

  /** @type {Array<Object>} the single source of truth — current overall order */
  let players = [];
  let boardName = '';

  let filters = { search: '', selectedPositions: new Set(), showDrafted: false, targetOnly: false };
  const FLEX_POSITIONS = ['RB', 'WR', 'TE'];

  // ---------- DOM refs ----------
  const el = {
    uploadScreen: document.getElementById('upload-screen'),
    boardScreen: document.getElementById('board-screen'),
    headerStatus: document.getElementById('header-status'),
    exportBtn: document.getElementById('export-btn'),
    undraftAllBtn: document.getElementById('undraft-all-btn'),
    startOverBtn: document.getElementById('start-over-btn'),
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('file-input'),
    uploadError: document.getElementById('upload-error'),
    downloadTemplateBtn: document.getElementById('download-template-btn'),
    boardNameInput: document.getElementById('board-name-input'),
    searchInput: document.getElementById('search-input'),
    posFilters: document.getElementById('pos-filters'),
    showDraftedToggle: document.getElementById('show-drafted-toggle'),
    targetFilterBtn: document.getElementById('target-filter-btn'),
    playerList: document.getElementById('player-list'),
    emptyState: document.getElementById('empty-state'),
  };

  // ---------- Init ----------
  function init() {
    bindUploadEvents();
    bindBoardEvents();
  }

  // ---------- Template & export downloads ----------
  function downloadCsv(filename, rows) {
    const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadTemplate() {
    downloadCsv('fffo-rankings-template.csv', [
      ['Board Name', 'PPR 12-Man'],
      ['Overall Rank', 'Player', 'Team', 'Position', 'Position Rank', 'Bye Week'],
      ['1', "Ja'Marr Chase", 'CIN', 'WR', '1', '10'],
      ['2', 'Bijan Robinson', 'ATL', 'RB', '1', '5'],
      ['3', 'Justin Jefferson', 'MIN', 'WR', '2', '6'],
    ]);
  }

  function slugify(str) {
    return String(str).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function exportBoard() {
    const withRanks = computeDisplayRanks();
    const rows = [];
    if (boardName) rows.push(['Board Name', boardName]);
    rows.push(
      ['Overall Rank', 'Player', 'Team', 'Position', 'Position Rank', 'Bye Week', 'Tag', 'Drafted'],
      ...withRanks.map(p => [
        p.overallRank,
        p.name,
        p.team,
        p.position,
        p.positionRank,
        p.bye,
        p.tag === 'target' ? 'Target' : p.tag === 'avoid' ? 'Avoid' : '',
        p.drafted ? 'Yes' : 'No',
      ])
    );
    const slug = slugify(boardName);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = slug ? `fffo-board-${slug}.csv` : `fffo-board-${stamp}.csv`;
    downloadCsv(filename, rows);
  }

  function csvEscape(val) {
    const s = String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // ---------- Upload handling ----------
  function bindUploadEvents() {
    el.dropzone.addEventListener('click', () => el.fileInput.click());
    el.dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
    });
    el.dropzone.setAttribute('tabindex', '0');
    el.dropzone.setAttribute('role', 'button');

    el.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.dropzone.classList.add('is-dragover');
    });
    el.dropzone.addEventListener('dragleave', () => el.dropzone.classList.remove('is-dragover'));
    el.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      el.dropzone.classList.remove('is-dragover');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    el.fileInput.addEventListener('change', () => {
      if (el.fileInput.files.length) handleFile(el.fileInput.files[0]);
    });

    el.downloadTemplateBtn.addEventListener('click', downloadTemplate);

    el.startOverBtn.addEventListener('click', () => {
      if (!confirm('Start over with a new upload? This clears your current board — export it first if you want to keep it.')) return;
      players = [];
      boardName = '';
      el.fileInput.value = '';
      showUpload();
    });

    el.exportBtn.addEventListener('click', exportBoard);

    el.undraftAllBtn.addEventListener('click', () => {
      if (!players.length) return;
      const draftedCount = players.filter(p => p.drafted).length;
      if (!draftedCount) return;
      if (!confirm(`Mark all ${draftedCount} drafted player(s) as available again? Rankings and Target/Avoid tags are kept.`)) return;
      players.forEach(p => { p.drafted = false; });
      render();
    });
  }

  function showUploadError(msg) {
    el.uploadError.textContent = msg;
    el.uploadError.hidden = false;
  }
  function clearUploadError() {
    el.uploadError.hidden = true;
    el.uploadError.textContent = '';
  }

  function handleFile(file) {
    clearUploadError();
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv')) {
      Papa.parse(file, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          const { boardName: metaName, rows } = extractBoardNameAndRows(results.data);
          processRows(rows, metaName);
        },
        error: (err) => showUploadError('Could not read that CSV: ' + err.message),
      });
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          const { boardName: metaName, rows } = extractBoardNameAndRows(grid);
          processRows(rows, metaName);
        } catch (err) {
          showUploadError('Could not read that spreadsheet: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      showUploadError('Please upload a .csv, .xlsx, or .xls file.');
    }
  }

  function normalizeKey(k) {
    return String(k || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  }

  const BOARD_NAME_LABELS = ['boardname', 'league', 'leaguename', 'description'];

  // Converts a raw grid (array of arrays, as from Papa.parse header:false or
  // XLSX header:1) into header-mapped row objects. If the very first row looks
  // like a "Board Name,<value>" metadata line, it's pulled out and returned
  // separately rather than treated as the header row.
  function extractBoardNameAndRows(grid) {
    const dataGrid = (grid || []).filter(r => r.some(c => String(c).trim() !== ''));
    let boardName = '';
    let bodyGrid = dataGrid;
    if (dataGrid.length) {
      const firstRowFilled = dataGrid[0].filter(c => String(c).trim() !== '');
      if (firstRowFilled.length <= 2 && BOARD_NAME_LABELS.includes(normalizeKey(dataGrid[0][0]))) {
        boardName = String(dataGrid[0][1] || '').trim();
        bodyGrid = dataGrid.slice(1);
      }
    }
    if (!bodyGrid.length) return { boardName, rows: [] };
    const headers = bodyGrid[0];
    const rows = bodyGrid.slice(1).map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i]; });
      return obj;
    });
    return { boardName, rows };
  }

  const COLUMN_MAP = {
    overallrank: 'overallRank',
    player: 'name',
    playername: 'name',
    position: 'position',
    pos: 'position',
    positionrank: 'positionRankUploaded',
    posrank: 'positionRankUploaded',
    team: 'team',
    byeweek: 'bye',
    bye: 'bye',
    tag: 'tagRaw',
    drafted: 'draftedRaw',
    boardname: 'boardNameRaw',
    league: 'boardNameRaw',
    leaguename: 'boardNameRaw',
    description: 'boardNameRaw',
  };

  // Splits a combined position value like "RB1" or "WR10" into { position: 'RB', rank: 1 }.
  // If there are no trailing digits, rank is null (it'll be auto-calculated from board order).
  function splitPosition(raw) {
    const cleaned = String(raw || '').trim().toUpperCase();
    const match = cleaned.match(/^([A-Z]+)(\d*)$/);
    if (!match) return { position: cleaned, rank: null };
    const letters = POSITION_ALIASES[match[1]] || match[1];
    const rank = match[2] ? Number(match[2]) : null;
    return { position: letters, rank };
  }

  function parseTag(raw) {
    const v = String(raw || '').trim().toLowerCase();
    if (v === 'target') return 'target';
    if (v === 'avoid') return 'avoid';
    return null;
  }

  function parseDrafted(raw) {
    const v = String(raw || '').trim().toLowerCase();
    return ['yes', 'true', '1', 'drafted'].includes(v);
  }

  function processRows(rows, metaBoardName) {
    if (!rows || !rows.length) {
      showUploadError('That file looks empty. Double check it has data rows below the header.');
      return;
    }

    // Map headers
    const firstRow = rows[0];
    const headerKeys = Object.keys(firstRow);
    const keyMap = {}; // original header -> normalized field
    headerKeys.forEach((h) => {
      const norm = normalizeKey(h);
      if (COLUMN_MAP[norm]) keyMap[h] = COLUMN_MAP[norm];
    });

    const required = ['name', 'position'];
    const mappedFields = new Set(Object.values(keyMap));
    const missing = required.filter(f => !mappedFields.has(f));
    if (missing.length) {
      showUploadError(
        'Missing required column(s): ' + (missing.includes('name') ? 'Player ' : '') + (missing.includes('position') ? 'Position' : '') +
        '. Download the template to see the expected format.'
      );
      return;
    }

    const parsed = [];
    let uploadedBoardName = metaBoardName || '';
    rows.forEach((row, i) => {
      const obj = {};
      Object.keys(row).forEach((h) => {
        if (keyMap[h]) obj[keyMap[h]] = row[h];
      });
      if (!uploadedBoardName && obj.boardNameRaw) {
        uploadedBoardName = String(obj.boardNameRaw).trim();
      }
      const name = String(obj.name || '').trim();
      const { position } = splitPosition(obj.position);
      if (!name || !position) return;
      parsed.push({
        id: 'p' + i + '_' + name.replace(/\W+/g, ''),
        name,
        position,
        team: String(obj.team || '').trim().toUpperCase(),
        bye: String(obj.bye || '').trim(),
        overallRankUploaded: Number(obj.overallRank) || (i + 1),
        tag: parseTag(obj.tagRaw),
        drafted: parseDrafted(obj.draftedRaw),
      });
    });

    if (!parsed.length) {
      showUploadError('No valid player rows found. Make sure Player and Position columns are filled in.');
      return;
    }

    // Sort by uploaded overall rank to establish initial order
    parsed.sort((a, b) => a.overallRankUploaded - b.overallRankUploaded);

    players = parsed;
    boardName = uploadedBoardName;
    el.boardNameInput.value = boardName;
    filters = { search: '', selectedPositions: new Set(), showDrafted: false, targetOnly: false };
    el.searchInput.value = '';
    el.showDraftedToggle.checked = false;
    el.targetFilterBtn.classList.remove('is-target-active');
    el.targetFilterBtn.setAttribute('aria-pressed', 'false');
    updatePosFilterUI();
    showBoard();
  }

  // ---------- Screen switching ----------
  function showUpload() {
    el.uploadScreen.hidden = false;
    el.boardScreen.hidden = true;
    el.headerStatus.hidden = true;
  }
  function showBoard() {
    el.uploadScreen.hidden = true;
    el.boardScreen.hidden = false;
    el.headerStatus.hidden = false;
    render();
  }

  // ---------- Ranking mutations ----------
  function indexOfPlayer(p) { return players.indexOf(p); }

  function swapOverall(p, direction) {
    const idx = indexOfPlayer(p);
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= players.length) return;
    [players[idx], players[targetIdx]] = [players[targetIdx], players[idx]];
    render();
  }

  function leapfrogPosition(p, direction) {
    const idx = indexOfPlayer(p);
    let j = -1;
    if (direction === -1) {
      for (let i = idx - 1; i >= 0; i--) {
        if (players[i].position === p.position) { j = i; break; }
      }
      if (j === -1) return; // already top of position
      players.splice(idx, 1);
      players.splice(j, 0, p);
    } else {
      for (let i = idx + 1; i < players.length; i++) {
        if (players[i].position === p.position) { j = i; break; }
      }
      if (j === -1) return; // already bottom of position
      players.splice(idx, 1);
      players.splice(j, 0, p); // j is already correct post-removal: neighbor shifted to j-1, so j puts p right after them
    }
    render();
  }

  function toggleTag(p, tag) {
    p.tag = p.tag === tag ? null : tag;
    render();
  }

  function toggleDrafted(p) {
    p.drafted = !p.drafted;
    render();
  }

  // ---------- Derived data ----------
  function computeDisplayRanks() {
    // overall rank = index+1 among ALL players (drafted or not) to keep ranks stable/meaningful
    const posCounters = {};
    return players.map((p, idx) => {
      posCounters[p.position] = (posCounters[p.position] || 0) + 1;
      return {
        ...p,
        overallRank: idx + 1,
        positionRank: posCounters[p.position],
      };
    });
  }

  function getFilteredPlayers() {
    const withRanks = computeDisplayRanks();
    return withRanks.filter((p) => {
      if (!filters.showDrafted && p.drafted) return false;
      if (filters.selectedPositions.size > 0 && !filters.selectedPositions.has(p.position)) return false;
      if (filters.targetOnly && p.tag !== 'target') return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!p.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  // ---------- Rendering ----------
  function render() {
    const list = getFilteredPlayers();

    el.playerList.innerHTML = '';
    el.emptyState.hidden = list.length !== 0;

    const frag = document.createDocumentFragment();
    list.forEach((p) => frag.appendChild(renderRow(p)));
    el.playerList.appendChild(frag);
  }

  function renderRow(p) {
    const li = document.createElement('li');
    const posClass = VALID_POS.includes(p.position) ? `pos-${p.position}` : '';
    li.className = [
      'player-row',
      posClass,
      p.tag === 'target' ? 'is-target' : '',
      p.tag === 'avoid' ? 'is-avoid' : '',
      p.drafted ? 'is-drafted' : '',
    ].filter(Boolean).join(' ');

    const tagBadge = p.tag
      ? `<span class="tag-badge tag-badge--${p.tag}">${p.tag === 'target' ? 'TARGET' : 'AVOID'}</span>`
      : '';

    li.innerHTML = `
      <div class="rank-chip">${p.overallRank}</div>
      <div class="player-main">
        <div class="player-name-row">
          <span class="player-name ${p.drafted ? 'is-drafted-text' : ''}">${escapeHtml(p.name)}</span>
          ${tagBadge}
        </div>
      </div>
      <div class="pos-cell"><span class="pos-tag">${escapeHtml(p.position)}${p.positionRank}</span></div>
      <div class="team-cell">${escapeHtml(p.team)}</div>
      <div class="bye-cell">${escapeHtml(p.bye)}</div>
      <div class="player-actions">
        <div class="act-group" aria-label="Overall rank">
          <button class="act-btn" data-action="overall-up" title="Increase overall ranking">${arrowSvg('up')}</button>
          <button class="act-btn" data-action="overall-down" title="Decrease overall ranking">${arrowSvg('down')}</button>
        </div>
        <div class="act-group" aria-label="Position rank">
          <button class="act-btn" data-action="pos-up" title="Increase position ranking">${arrowSvg('up')}<span style="font-size:9px;margin-left:1px;">P</span></button>
          <button class="act-btn" data-action="pos-down" title="Decrease position ranking">${arrowSvg('down')}<span style="font-size:9px;margin-left:1px;">P</span></button>
        </div>
        <button class="act-btn ${p.tag === 'target' ? 'is-on-target' : ''}" data-action="target" title="Mark as target">★</button>
        <button class="act-btn ${p.tag === 'avoid' ? 'is-on-avoid' : ''}" data-action="avoid" title="Mark as avoid">✕</button>
        <button class="act-btn act-btn--draft ${p.drafted ? 'is-drafted' : ''}" data-action="draft" title="Toggle drafted">${p.drafted ? 'Undo' : 'Drafted'}</button>
      </div>
    `;

    li.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handleAction(p.id, btn.getAttribute('data-action')));
    });

    return li;
  }

  function arrowSvg(dir) {
    const path = dir === 'up' ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6';
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="${path}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function handleAction(id, action) {
    const p = players.find(pl => pl.id === id);
    if (!p) return;
    switch (action) {
      case 'overall-up': swapOverall(p, -1); break;
      case 'overall-down': swapOverall(p, 1); break;
      case 'pos-up': leapfrogPosition(p, -1); break;
      case 'pos-down': leapfrogPosition(p, 1); break;
      case 'target': toggleTag(p, 'target'); break;
      case 'avoid': toggleTag(p, 'avoid'); break;
      case 'draft': toggleDrafted(p); break;
    }
  }

  // ---------- Board controls ----------
  function updatePosFilterUI() {
    el.posFilters.querySelectorAll('.pos-pill').forEach((btn) => {
      if (btn === el.targetFilterBtn) return;
      const pos = btn.getAttribute('data-pos');
      let active;
      if (pos === 'ALL') {
        active = filters.selectedPositions.size === 0;
      } else if (pos === 'FLEX') {
        active = FLEX_POSITIONS.every(p => filters.selectedPositions.has(p));
      } else {
        active = filters.selectedPositions.has(pos);
      }
      btn.classList.toggle('is-active', active);
    });
  }

  function bindBoardEvents() {
    el.boardNameInput.addEventListener('input', () => {
      boardName = el.boardNameInput.value;
    });

    el.searchInput.addEventListener('input', () => {
      filters.search = el.searchInput.value;
      render();
    });

    el.posFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('.pos-pill');
      if (!btn || btn === el.targetFilterBtn) return;
      const pos = btn.getAttribute('data-pos');

      if (pos === 'ALL') {
        filters.selectedPositions.clear();
      } else if (pos === 'FLEX') {
        const allFlexActive = FLEX_POSITIONS.every(p => filters.selectedPositions.has(p));
        if (allFlexActive) {
          FLEX_POSITIONS.forEach(p => filters.selectedPositions.delete(p));
        } else {
          FLEX_POSITIONS.forEach(p => filters.selectedPositions.add(p));
        }
      } else {
        if (filters.selectedPositions.has(pos)) {
          filters.selectedPositions.delete(pos);
        } else {
          filters.selectedPositions.add(pos);
        }
      }

      updatePosFilterUI();
      render();
    });

    el.targetFilterBtn.addEventListener('click', () => {
      filters.targetOnly = !filters.targetOnly;
      el.targetFilterBtn.classList.toggle('is-target-active', filters.targetOnly);
      el.targetFilterBtn.setAttribute('aria-pressed', String(filters.targetOnly));
      render();
    });

    el.showDraftedToggle.addEventListener('change', () => {
      filters.showDrafted = el.showDraftedToggle.checked;
      render();
    });
  }

  init();
})();
