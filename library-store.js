const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const resolveStorePath = (value, fallbackPath) => {
  if (!value) {
    return fallbackPath;
  }

  if (value === ':memory:') {
    return value;
  }

  return path.isAbsolute(value) ? value : path.join(__dirname, value);
};

const resolveDataDirectory = () => {
  if (process.env.LYTUNE_DATA_DIR) {
    return path.isAbsolute(process.env.LYTUNE_DATA_DIR)
      ? process.env.LYTUNE_DATA_DIR
      : path.join(__dirname, process.env.LYTUNE_DATA_DIR);
  }

  // Vercel functions can only write to /tmp at runtime.
  if (process.env.VERCEL) {
    return path.join('/tmp', 'lytune-data');
  }

  return path.join(__dirname, 'data');
};

const DATA_DIRECTORY = resolveDataDirectory();
const LEGACY_LIBRARY_STORE_PATH = resolveStorePath(
  process.env.LYTUNE_LIBRARY_STORE_PATH,
  path.join(DATA_DIRECTORY, 'library-store.json')
);
const LIBRARY_DATABASE_PATH = resolveStorePath(
  process.env.LYTUNE_LIBRARY_DB_PATH,
  path.join(DATA_DIRECTORY, 'lytune.sqlite')
);

let database = null;

const cloneValue = (value) => JSON.parse(JSON.stringify(value));

const normalizeSearchValue = (value = '') =>
  (value ?? '')
    .toString()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const formatContentTypeLabel = (type = '') => {
  switch (type) {
    case 'track':
      return 'Song';
    case 'artist':
      return 'Artist';
    case 'album':
      return 'Album';
    case 'playlist':
      return 'Playlist';
    case 'podcast':
      return 'Podcast';
    default:
      return 'Content';
  }
};

const LIBRARY_PROFILE_TEMPLATE = {
  displayName: 'Guest Listener',
  summary: {
    savedCount: 128,
    recentSessions: 7,
    followingCount: 12
  },
  savedItemIds: [
    'local-playlist-1',
    'local-track-2',
    'local-podcast-1',
    'local-artist-1',
    'local-album-2',
    'local-track-4',
    'local-podcast-2',
    'local-artist-2',
    'local-artist-3',
    'local-podcast-4',
    'local-podcast-6'
  ],
  pinned: [
    {
      contentId: 'local-playlist-1',
      category: 'music',
      tag: 'Playlist',
      note: 'Lytune editorial mix built for your daily replay.'
    },
    {
      contentId: 'local-track-2',
      category: 'music',
      tag: 'Liked song',
      note: 'Burna Boy still leads your most played rotation.'
    },
    {
      contentId: 'local-podcast-1',
      category: 'podcast',
      tag: 'Saved podcast',
      note: 'Lytune Original stories and music conversations you saved for later.'
    },
    {
      contentId: 'local-artist-1',
      category: 'creator',
      tag: 'Following',
      note: 'Your library keeps favorite creators close, not buried in search.'
    }
  ],
  recent: [
    {
      contentId: 'local-album-2',
      category: 'music',
      note: 'Ayra Starr - Album - Started 18 minutes ago'
    },
    {
      contentId: 'local-track-4',
      category: 'music',
      note: 'Rema - Track - In heavy rotation this week'
    },
    {
      contentId: 'local-podcast-2',
      category: 'podcast',
      note: 'Lytune Sessions - Podcast - Picked back up last night'
    }
  ],
  creators: [
    {
      contentId: 'local-artist-2',
      category: 'creator',
      note: 'Soulful, cinematic, and always replayable.'
    },
    {
      contentId: 'local-artist-3',
      category: 'creator',
      note: 'Your high-energy Afropop lane stays within reach.'
    },
    {
      contentId: 'local-podcast-4',
      category: 'podcast',
      note: 'Creator Room brings the making-of angle you keep saving.'
    },
    {
      contentId: 'local-podcast-6',
      category: 'podcast',
      note: 'Spotlights voices and scenes building the next wave.'
    }
  ],
  vault: [
    {
      id: 'vault-1',
      category: 'music',
      label: 'Queue',
      title: 'Night drive sequence',
      description: 'Tems, Omah Lay, and soft mood records stacked for later playback.'
    },
    {
      id: 'vault-2',
      category: 'podcast',
      label: 'Episodes',
      title: '3 unfinished stories',
      description: 'Saved podcast episodes are waiting at the exact point where you paused.'
    },
    {
      id: 'vault-3',
      category: 'creator',
      label: 'Following',
      title: 'Release alerts on',
      description: 'Library is ready for future notifications once the backend handles follows and updates.'
    }
  ],
  downloads: {
    summary: {
      storageUsedGb: 3.2,
      storageReservedGb: 8,
      readyCount: 48,
      queueCount: 6
    },
    ready: [
      {
        contentId: 'local-track-1',
        category: 'music',
        tag: 'Track - Offline',
        note: 'Shallipopi - Downloaded in high quality'
      },
      {
        contentId: 'local-album-1',
        category: 'music',
        tag: 'Album - Offline',
        note: 'Asake - Cached for full offline listening'
      },
      {
        contentId: 'local-podcast-3',
        category: 'podcast',
        tag: 'Podcast - Offline',
        note: 'Lytune Editorial - Latest episode stored on device'
      },
      {
        contentId: 'local-podcast-5',
        category: 'podcast',
        tag: 'Podcast - Offline',
        note: 'Lytune Voices - Ready for lower-data playback'
      }
    ],
    queue: [
      {
        contentId: 'local-track-3',
        category: 'queued',
        title: 'Love Me JeJe',
        note: 'Tems - Waiting for stronger connection',
        status: 'pending'
      },
      {
        contentId: 'local-podcast-6',
        category: 'queued',
        title: 'Mic Check Africa',
        note: 'Lytune Spotlight - Download paused at 68%',
        status: 'active'
      },
      {
        contentId: 'local-playlist-1',
        category: 'queued',
        title: 'Afrobeats Pulse',
        note: 'Lytune - Playlist batch waiting behind current jobs',
        status: 'pending'
      }
    ],
    settings: {
      wifiOnly: true,
      smartCleanupDays: 21
    },
    statusCards: [
      {
        id: 'status-finished',
        label: 'Finished',
        title: 'Offline tracks and episodes',
        description: 'These will become real saved files tied to the signed-in Lytune account.'
      },
      {
        id: 'status-queued',
        label: 'Queued',
        title: 'Priority order and retries',
        description: 'We can surface waiting jobs, pause states, and retry rules once the backend is active.'
      },
      {
        id: 'status-errors',
        label: 'Errors',
        title: 'Failed download recovery',
        description: 'The page is already shaped to show expired links, low storage, or broken network issues clearly.'
      }
    ]
  },
  history: [
    {
      contentId: 'local-album-2',
      note: 'Ayra Starr - Album - Started 18 minutes ago',
      playedAt: null
    },
    {
      contentId: 'local-track-4',
      note: 'Rema - Track - In heavy rotation this week',
      playedAt: null
    },
    {
      contentId: 'local-podcast-2',
      note: 'Lytune Sessions - Podcast - Picked back up last night',
      playedAt: null
    }
  ],
  playlists: [
    {
      id: 'playlist-user-1',
      title: 'Evening Recharge',
      description: 'Soft landing songs for calm, reflective listening.',
      coverImage: 'assets/images/Album 7.png',
      itemIds: ['local-track-2', 'local-track-3', 'local-track-5'],
      updatedAt: null
    },
    {
      id: 'playlist-user-2',
      title: 'Focus and Motion',
      description: 'A tighter run of records for long work sessions and steady momentum.',
      coverImage: 'assets/images/Album 4.png',
      itemIds: ['local-track-1', 'local-track-4', 'local-album-1'],
      updatedAt: null
    }
  ],
  moments: {},
  createdAt: null,
  updatedAt: null
};

const createEmptyLibraryStore = () => ({
  users: {}
});

const ensureArray = (value, fallback = []) => (Array.isArray(value) ? value : fallback);
const ensureObject = (value, fallback = {}) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;

const createDefaultLibraryProfile = (displayName = 'Guest Listener') => {
  const now = new Date().toISOString();
  const profile = cloneValue(LIBRARY_PROFILE_TEMPLATE);
  profile.displayName = displayName;
  profile.createdAt = now;
  profile.updatedAt = now;
  return profile;
};

const normalizeLibraryProfile = (profile, displayName = 'Guest Listener') => {
  const baseProfile = createDefaultLibraryProfile(displayName);
  const safeProfile = ensureObject(profile);
  const safeDownloads = ensureObject(safeProfile.downloads);

  return {
    ...baseProfile,
    ...safeProfile,
    displayName:
      safeProfile.displayName?.toString().trim() ||
      displayName ||
      baseProfile.displayName,
    summary: {
      ...baseProfile.summary,
      ...ensureObject(safeProfile.summary)
    },
    savedItemIds: ensureArray(safeProfile.savedItemIds, baseProfile.savedItemIds),
    pinned: ensureArray(safeProfile.pinned, baseProfile.pinned),
    recent: ensureArray(safeProfile.recent, baseProfile.recent),
    creators: ensureArray(safeProfile.creators, baseProfile.creators),
    vault: ensureArray(safeProfile.vault, baseProfile.vault),
    downloads: {
      ...baseProfile.downloads,
      ...safeDownloads,
      summary: {
        ...baseProfile.downloads.summary,
        ...ensureObject(safeDownloads.summary)
      },
      ready: ensureArray(safeDownloads.ready, baseProfile.downloads.ready),
      queue: ensureArray(safeDownloads.queue, baseProfile.downloads.queue),
      settings: {
        ...baseProfile.downloads.settings,
        ...ensureObject(safeDownloads.settings)
      },
      statusCards: ensureArray(safeDownloads.statusCards, baseProfile.downloads.statusCards)
    },
    history: ensureArray(safeProfile.history, baseProfile.history),
    playlists: ensureArray(safeProfile.playlists, baseProfile.playlists),
    moments: ensureObject(safeProfile.moments),
    createdAt: safeProfile.createdAt || baseProfile.createdAt,
    updatedAt: safeProfile.updatedAt || baseProfile.updatedAt
  };
};

const ensureDataDirectory = () => {
  if (!fs.existsSync(DATA_DIRECTORY)) {
    fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  }
};

const ensureDatabaseDirectory = () => {
  if (LIBRARY_DATABASE_PATH === ':memory:') {
    return;
  }

  const directory = path.dirname(LIBRARY_DATABASE_PATH);

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
};

const readLegacyLibraryStore = () => {
  ensureDataDirectory();

  if (!fs.existsSync(LEGACY_LIBRARY_STORE_PATH)) {
    return createEmptyLibraryStore();
  }

  try {
    const rawValue = fs.readFileSync(LEGACY_LIBRARY_STORE_PATH, 'utf8');
    const parsedValue = JSON.parse(rawValue);

    if (!parsedValue || typeof parsedValue !== 'object' || !parsedValue.users) {
      throw new Error('Invalid legacy library store shape.');
    }

    const normalizedUsers = Object.fromEntries(
      Object.entries(parsedValue.users).map(([key, profile]) => [
        key,
        normalizeLibraryProfile(profile)
      ])
    );

    return {
      ...parsedValue,
      users: normalizedUsers
    };
  } catch (error) {
    return createEmptyLibraryStore();
  }
};

const ensureDatabase = () => {
  if (database) {
    return database;
  }

  ensureDataDirectory();
  ensureDatabaseDirectory();

  database = new DatabaseSync(LIBRARY_DATABASE_PATH);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS library_profiles (
      user_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_library_profiles_updated_at
      ON library_profiles(updated_at DESC);
  `);

  migrateLegacyLibraryStore(database);
  return database;
};

const countStoredProfiles = (db) => {
  const row = db.prepare('SELECT COUNT(*) AS total FROM library_profiles').get();
  return Number(row?.total || 0);
};

const persistProfilesToDatabase = (db, store) => {
  const safeStore = ensureObject(store, createEmptyLibraryStore());
  const normalizedUsers = Object.fromEntries(
    Object.entries(ensureObject(safeStore.users)).map(([key, profile]) => [
      sanitizeLibraryUserKey(key),
      normalizeLibraryProfile(profile)
    ])
  );

  const insertStatement = db.prepare(`
    INSERT INTO library_profiles (
      user_key,
      display_name,
      profile_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN IMMEDIATE');

  try {
    db.exec('DELETE FROM library_profiles');

    Object.entries(normalizedUsers).forEach(([userKey, profile]) => {
      const createdAt = profile.createdAt || new Date().toISOString();
      const updatedAt = profile.updatedAt || createdAt;

      insertStatement.run(
        userKey,
        profile.displayName || 'Guest Listener',
        JSON.stringify({
          ...profile,
          createdAt,
          updatedAt
        }),
        createdAt,
        updatedAt
      );
    });

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};

const migrateLegacyLibraryStore = (db) => {
  if (countStoredProfiles(db) > 0) {
    return;
  }

  const legacyStore = readLegacyLibraryStore();

  if (!Object.keys(legacyStore.users || {}).length) {
    return;
  }

  persistProfilesToDatabase(db, legacyStore);
};

const readLibraryStore = () => {
  const db = ensureDatabase();
  const rows = db.prepare(`
    SELECT
      user_key AS userKey,
      display_name AS displayName,
      profile_json AS profileJson,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM library_profiles
    ORDER BY user_key ASC
  `).all();

  const users = {};

  rows.forEach((row) => {
    let parsedProfile = {};

    try {
      parsedProfile = JSON.parse(row.profileJson || '{}');
    } catch (error) {
      parsedProfile = {};
    }

    users[row.userKey] = normalizeLibraryProfile(
      {
        ...ensureObject(parsedProfile),
        displayName: parsedProfile.displayName || row.displayName,
        createdAt: parsedProfile.createdAt || row.createdAt,
        updatedAt: parsedProfile.updatedAt || row.updatedAt
      },
      row.displayName
    );
  });

  return {
    users
  };
};

const writeLibraryStore = (store) => {
  const db = ensureDatabase();
  persistProfilesToDatabase(db, store);
};

const createLibraryContentUrl = (type, id) => {
  const params = new URLSearchParams({
    type,
    id
  });

  if (type === 'track') {
    params.set('autoplay', '1');
  }

  return `content.html?${params.toString()}`;
};

const getLibraryCategoryForType = (type = '') => {
  if (type === 'podcast') {
    return 'podcast';
  }

  if (type === 'artist') {
    return 'creator';
  }

  return 'music';
};

const sanitizeLibraryUserKey = (value = '') => {
  const normalizedValue = normalizeSearchValue(value).replace(/[^a-z0-9@._-]+/g, '-');
  return normalizedValue || 'guest';
};

const resolveLibraryUser = (req) => {
  const requestedUser =
    req.get('x-lytune-user') ||
    req.query.user ||
    req.body?.user ||
    req.get('x-lytune-email') ||
    'guest';
  const displayName =
    (req.get('x-lytune-user-name') ||
      req.query.displayName ||
      req.body?.displayName ||
      requestedUser ||
      'Guest Listener')
      .toString()
      .trim() || 'Guest Listener';

  return {
    key: sanitizeLibraryUserKey(requestedUser),
    displayName
  };
};

const getOrCreateLibraryProfile = (store, userContext) => {
  const existingProfile = store.users[userContext.key];

  if (!existingProfile) {
    const createdProfile = createDefaultLibraryProfile(userContext.displayName);
    store.users[userContext.key] = createdProfile;
    return { profile: createdProfile, created: true };
  }

  const normalizedProfile = normalizeLibraryProfile(existingProfile, userContext.displayName);
  store.users[userContext.key] = normalizedProfile;

  if (userContext.displayName && normalizedProfile.displayName !== userContext.displayName) {
    normalizedProfile.displayName = userContext.displayName;
    normalizedProfile.updatedAt = new Date().toISOString();
  }

  return { profile: normalizedProfile, created: false };
};

const buildLibraryContentItem = (catalogById, entry, fallbackTag = null) => {
  const content = catalogById.get(entry.contentId);

  if (!content) {
    return null;
  }

  return {
    id: content.id,
    type: content.type,
    category: entry.category || getLibraryCategoryForType(content.type),
    tag: entry.tag || fallbackTag || formatContentTypeLabel(content.type),
    title: content.title,
    subtitle: content.subtitle,
    image: content.image,
    note: entry.note || content.description,
    href: createLibraryContentUrl(content.type, content.id),
    isSaved: true
  };
};

const buildLibraryPayload = (profile, catalog) => {
  const catalogById = new Map(catalog.map((item) => [item.id, item]));

  return {
    summary: {
      savedCount: Number.isFinite(profile.summary?.savedCount)
        ? profile.summary.savedCount
        : profile.savedItemIds?.length || 0,
      recentSessions: Number.isFinite(profile.summary?.recentSessions)
        ? profile.summary.recentSessions
        : profile.recent?.length || 0,
      followingCount: Number.isFinite(profile.summary?.followingCount)
        ? profile.summary.followingCount
        : profile.creators?.length || 0
    },
    pinned: (profile.pinned || [])
      .map((entry) => buildLibraryContentItem(catalogById, entry))
      .filter(Boolean),
    recent: (profile.recent || [])
      .map((entry) => buildLibraryContentItem(catalogById, entry, 'Recent'))
      .filter(Boolean),
    creators: (profile.creators || [])
      .map((entry) => buildLibraryContentItem(catalogById, entry, 'Following'))
      .filter(Boolean),
    vault: (profile.vault || []).map((entry) => ({
      id: entry.id,
      category: entry.category || 'music',
      label: entry.label,
      title: entry.title,
      description: entry.description
    })),
    savedItemIds: profile.savedItemIds || [],
    updatedAt: profile.updatedAt || null
  };
};

const createLibraryEntryFromContent = (content, note, tag = null) => ({
  contentId: content.id,
  category: getLibraryCategoryForType(content.type),
  tag: tag || formatContentTypeLabel(content.type),
  note
});

const buildDownloadsContentItem = (catalogById, entry) => {
  const content = catalogById.get(entry.contentId);

  if (!content) {
    return null;
  }

  return {
    id: content.id,
    type: content.type,
    category: entry.category || getLibraryCategoryForType(content.type),
    tag: entry.tag || `${formatContentTypeLabel(content.type)} - Offline`,
    title: entry.title || content.title,
    subtitle: content.subtitle,
    image: content.image,
    note: entry.note || content.description,
    href: createLibraryContentUrl(content.type, content.id)
  };
};

const buildDownloadsPayload = (profile, catalog) => {
  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  const downloads = profile.downloads || {};
  const summary = downloads.summary || {};
  const readyItems = (downloads.ready || [])
    .map((entry) => buildDownloadsContentItem(catalogById, entry))
    .filter(Boolean);
  const queueItems = (downloads.queue || [])
    .map((entry) => {
      const content = catalogById.get(entry.contentId);
      const fallbackType = content?.type || 'track';

      return {
        id: entry.contentId,
        type: fallbackType,
        category: entry.category || 'queued',
        title: entry.title || content?.title || 'Queued item',
        note: entry.note || content?.description || 'Waiting for download processing.',
        status: entry.status || 'pending',
        href: content ? createLibraryContentUrl(content.type, content.id) : null
      };
    })
    .filter(Boolean);

  return {
    summary: {
      storageUsedGb: Number.isFinite(summary.storageUsedGb) ? summary.storageUsedGb : 0,
      storageReservedGb: Number.isFinite(summary.storageReservedGb) ? summary.storageReservedGb : 8,
      readyCount: Number.isFinite(summary.readyCount) ? summary.readyCount : readyItems.length,
      queueCount: Number.isFinite(summary.queueCount) ? summary.queueCount : queueItems.length
    },
    ready: readyItems,
    queue: queueItems,
    settings: {
      wifiOnly: downloads.settings?.wifiOnly !== false,
      smartCleanupDays: Number.isFinite(downloads.settings?.smartCleanupDays)
        ? downloads.settings.smartCleanupDays
        : 21
    },
    statusCards: (downloads.statusCards || []).map((item) => ({
      id: item.id,
      label: item.label,
      title: item.title,
      description: item.description
    })),
    updatedAt: profile.updatedAt || null
  };
};

const buildHistoryPayload = (profile, catalog) => {
  const catalogById = new Map(catalog.map((item) => [item.id, item]));

  return (profile.history || [])
    .map((entry) => {
      const content = catalogById.get(entry.contentId);

      if (!content) {
        return null;
      }

      return {
        id: content.id,
        type: content.type,
        title: content.title,
        subtitle: content.subtitle,
        image: content.image,
        note: entry.note || content.description,
        playedAt: entry.playedAt || null,
        href: createLibraryContentUrl(content.type, content.id)
      };
    })
    .filter(Boolean);
};

const buildPlaylistsPayload = (profile, catalog) => {
  const catalogById = new Map(catalog.map((item) => [item.id, item]));

  return (profile.playlists || []).map((playlist) => ({
    id: playlist.id,
    title: playlist.title,
    description: playlist.description,
    coverImage: playlist.coverImage || 'assets/images/logo.png',
    itemCount: (playlist.itemIds || []).length,
    updatedAt: playlist.updatedAt || profile.updatedAt || null,
    items: (playlist.itemIds || [])
      .map((itemId) => catalogById.get(itemId))
      .filter(Boolean)
      .map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        subtitle: item.subtitle,
        image: item.image,
        href: createLibraryContentUrl(item.type, item.id)
      }))
  }));
};

const buildMomentPayload = (profile, contentId) => {
  const savedMoment = profile.moments?.[contentId] || null;

  return {
    contentId,
    mood: savedMoment?.mood || '',
    note: savedMoment?.note || '',
    updatedAt: savedMoment?.updatedAt || null
  };
};

const formatHistoryNote = (content, fallbackPrefix = 'Played recently') => {
  const detail = content.subtitle
    ? `${content.subtitle} - ${formatContentTypeLabel(content.type)}`
    : formatContentTypeLabel(content.type);

  return `${detail} - ${fallbackPrefix}`;
};

const updateRecentFromHistory = (profile, content, note) => {
  profile.recent = [
    {
      contentId: content.id,
      category: getLibraryCategoryForType(content.type),
      note
    },
    ...(profile.recent || []).filter((entry) => entry.contentId !== content.id)
  ].slice(0, 3);
};

const updateSummaryFromProfile = (profile) => {
  profile.summary = profile.summary || {};
  profile.summary.savedCount = Math.max(
    Number.isFinite(profile.summary.savedCount) ? profile.summary.savedCount : 0,
    (profile.savedItemIds || []).length
  );
  profile.summary.recentSessions = Math.max(
    Number.isFinite(profile.summary.recentSessions) ? profile.summary.recentSessions : 0,
    (profile.history || []).length
  );
  profile.summary.followingCount = Math.max(
    Number.isFinite(profile.summary.followingCount) ? profile.summary.followingCount : 0,
    (profile.creators || []).filter((entry) => entry.category === 'creator').length
  );

  profile.downloads = profile.downloads || {};
  profile.downloads.summary = profile.downloads.summary || {};
  profile.downloads.summary.readyCount = Math.max(
    Number.isFinite(profile.downloads.summary.readyCount) ? profile.downloads.summary.readyCount : 0,
    (profile.downloads.ready || []).length
  );
  profile.downloads.summary.queueCount = Math.max(
    Number.isFinite(profile.downloads.summary.queueCount) ? profile.downloads.summary.queueCount : 0,
    (profile.downloads.queue || []).length
  );
};

module.exports = {
  buildDownloadsPayload,
  buildHistoryPayload,
  buildLibraryPayload,
  buildMomentPayload,
  buildPlaylistsPayload,
  createLibraryEntryFromContent,
  formatHistoryNote,
  getLibraryCategoryForType,
  getOrCreateLibraryProfile,
  readLibraryStore,
  resolveLibraryUser,
  updateRecentFromHistory,
  updateSummaryFromProfile,
  writeLibraryStore
};
