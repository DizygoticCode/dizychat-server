const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.join(__dirname, '..', '..', 'data', 'soundboards');
const PUBLIC_PREFIX = '/soundboards/';

let cache = null;

const normaliseString = (value) =>
  typeof value === 'string' ? value.trim() : '';

const normaliseArray = (value) =>
  Array.isArray(value) ? value : [];

const safeFilePath = (boardId, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) return '';
  const clean = filePath.replace(/\\+/g, '/').replace(/\.\.+/g, '.');
  const resolved = path.posix.join(boardId, clean);
  return `${PUBLIC_PREFIX}${resolved}`;
};

const normaliseUrl = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return '';
};

const loadBoardFile = (boardId) => {
  const filePath = path.join(DATA_ROOT, `${boardId}.json`);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object') return null;
    const items = Array.isArray(payload.items) ? payload.items : [];
    return {
      id: normaliseString(payload.id) || boardId,
      title: normaliseString(payload.title) || boardId,
      description: normaliseString(payload.description),
      source: normaliseString(payload.source),
      items: items
        .map((item, index) => {
          if (!item || typeof item !== 'object') return null;
          const itemId = normaliseString(item.id) || `${boardId}-${index}`;
          const title = normaliseString(item.title) || 'Sound Clip';
          const tags = normaliseArray(item.tags).map((tag) => normaliseString(tag)).filter(Boolean);
          const file = normaliseString(item.file);
          const localUrl = file ? safeFilePath(boardId, file) : '';
          const explicitUrl = normaliseUrl(item.url || item.audioUrl || item.previewUrl);
          const audioUrl = localUrl || explicitUrl;
          if (!audioUrl) return null;
          const duration = Number(item.duration) || 0;
          return {
            id: itemId,
            title,
            tags,
            duration,
            audioUrl,
          };
        })
        .filter(Boolean),
    };
  } catch (err) {
    console.error(`[Soundboard] Could not load board ${boardId}:`, err.message);
    return null;
  }
};

const loadCache = () => {
  try {
    const indexPath = path.join(DATA_ROOT, 'index.json');
    const raw = fs.readFileSync(indexPath, 'utf8');
    const payload = JSON.parse(raw);
    const boardIds = Array.isArray(payload?.boards) ? payload.boards : [];
    const boards = boardIds
      .map((id) => normaliseString(id))
      .filter(Boolean)
      .map((id) => loadBoardFile(id))
      .filter(Boolean);

    cache = {
      boards,
      loadedAt: Date.now(),
    };
  } catch (err) {
    console.error('[Soundboard] Could not load index:', err.message);
    cache = { boards: [], loadedAt: Date.now() };
  }
  return cache;
};

const getCache = () => {
  if (!cache) {
    return loadCache();
  }
  return cache;
};

const searchClips = ({ query = '', boardId } = {}) => {
  const { boards } = getCache();
  const normalisedQuery = normaliseString(query).toLowerCase();
  const targetBoard = normaliseString(boardId);

  const matches = [];
  boards.forEach((board) => {
    if (targetBoard && board.id !== targetBoard) return;
    board.items.forEach((item) => {
      if (normalisedQuery) {
        const haystacks = [
          item.title.toLowerCase(),
          board.title.toLowerCase(),
          board.id.toLowerCase(),
          item.tags.join(' ').toLowerCase(),
        ];
        const found = haystacks.some((value) => value.includes(normalisedQuery));
        if (!found) return;
      }
      matches.push({
        id: `${board.id}::${item.id}`,
        title: item.title,
        tags: item.tags.join(', '),
        duration: item.duration,
        audioUrl: item.audioUrl,
        previewUrl: item.audioUrl,
        boardId: board.id,
        boardTitle: board.title,
      });
    });
  });

  return {
    hits: matches,
    total: matches.length,
    boards,
  };
};

const reload = () => {
  cache = null;
  return getCache();
};

module.exports = {
  searchClips,
  reload,
  getCache,
};
