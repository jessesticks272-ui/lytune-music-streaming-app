const fs = require('fs');
const path = require('path');
const express = require('express');
const {
  MIN_PASSWORD_LENGTH,
  buildPublicAuthUser,
  clearAuthSession,
  createAuthSession,
  createLocalAuthUser,
  isValidAuthEmail,
  isValidAuthPassword,
  normalizeAuthEmail,
  readAuthStore,
  resolveAuthSession,
  updateAuthUserProfile,
  upsertGoogleAuthUser,
  verifyLocalPassword,
  writeAuthStore
} = require('./auth-store');
const app = express();
const PORT = 3000;
const PREFERRED_LOCAL_HOSTNAME = 'lytune.localhost';
const PREFERRED_LOCAL_ORIGIN = `http://${PREFERRED_LOCAL_HOSTNAME}:${PORT}`;
const LEGACY_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

const loadLocalEnvFile = () => {
  const envPath = path.join(__dirname, '.env');

  if (!fs.existsSync(envPath)) {
    return;
  }

  try {
    const rawValue = fs.readFileSync(envPath, 'utf8');

    rawValue.split(/\r?\n/).forEach((line) => {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith('#')) {
        return;
      }

      const separatorIndex = trimmedLine.indexOf('=');

      if (separatorIndex <= 0) {
        return;
      }

      const key = trimmedLine.slice(0, separatorIndex).trim();
      const rawEntry = trimmedLine.slice(separatorIndex + 1).trim();
      const normalizedValue = rawEntry.replace(/^["']|["']$/g, '');

      if (key && !process.env[key]) {
        process.env[key] = normalizedValue;
      }
    });
  } catch (error) {
    console.error('Could not load .env file:', error);
  }
};

loadLocalEnvFile();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

app.use(express.json());
app.use((req, res, next) => {
  const hostHeader = (req.get('host') || '').toLowerCase();
  const requestHost = hostHeader.split(':')[0];
  const acceptsHtml = (req.get('accept') || '').includes('text/html');
  const isHtmlRequest = req.path === '/' || /\.html?$/i.test(req.path) || acceptsHtml;

  if (
    ['GET', 'HEAD'].includes(req.method) &&
    LEGACY_LOCAL_HOSTS.has(requestHost) &&
    !req.path.startsWith('/api/') &&
    isHtmlRequest
  ) {
    return res.redirect(302, `${PREFERRED_LOCAL_ORIGIN}${req.originalUrl}`);
  }

  next();
});
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.get('origin') || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Lytune-User, X-Lytune-User-Name, X-Lytune-Email, X-Lytune-Auth-Token'
  );

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});
app.use(express.static(__dirname));

const DEEZER_TIMEOUT_MS = 5500;
const HOME_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const PODCAST_CACHE_TTL_MS = 5 * 60 * 1000;
const LYRICS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DATA_DIRECTORY = path.join(__dirname, 'data');
const LIBRARY_STORE_PATH = path.join(DATA_DIRECTORY, 'library-store.json');
let deezerHomeCache = {
  expiresAt: 0,
  payload: null
};
let searchCatalogCache = {
  expiresAt: 0,
  items: [],
  source: 'fallback'
};
let podcastCatalogCache = {
  expiresAt: 0,
  items: [],
  source: 'fallback'
};
const lyricsCache = new Map();

const LOCAL_SEARCH_CATALOG = [
  {
    id: 'local-track-1',
    type: 'track',
    title: 'Laho',
    subtitle: 'Shallipopi',
    image: 'assets/images/Album 1.png',
    detail: 'Track • Street pop energy • Trending on Lytune',
    tokens: ['afrobeats', 'new releases', 'shallipopi', 'song', 'music'],
    duration: 167,
    albumTitle: 'Presido La Pluto'
  },
  {
    id: 'local-track-2',
    type: 'track',
    title: 'Higher',
    subtitle: 'Burna Boy',
    image: 'assets/images/Album 2.png',
    detail: 'Track • Burna Boy • High rotation',
    tokens: ['afrobeats', 'burna boy', 'song', 'music'],
    duration: 178,
    albumTitle: 'Lytune Fallback Sessions'
  },
  {
    id: 'local-track-3',
    type: 'track',
    title: 'Love Me JeJe',
    subtitle: 'Tems',
    image: 'assets/images/Album 3.png',
    detail: 'Track • Tems • Smooth replay favorite',
    tokens: ['tems', 'soul', 'song', 'music'],
    duration: 164,
    albumTitle: 'Born in the Wild'
  },
  {
    id: 'local-track-4',
    type: 'track',
    title: 'Ozeba',
    subtitle: 'Rema',
    image: 'assets/images/Album 4.png',
    detail: 'Track • Rema • Global afropop momentum',
    tokens: ['rema', 'afrobeats', 'party', 'song'],
    duration: 152,
    albumTitle: 'HEIS'
  },
  {
    id: 'local-track-5',
    type: 'track',
    title: 'Piece of My Heart',
    subtitle: 'Wizkid',
    image: 'assets/images/Album 5.png',
    detail: 'Track • Wizkid • Late-night replay',
    tokens: ['wizkid', 'afrobeats', 'romance', 'song'],
    duration: 187,
    albumTitle: 'Morayo'
  },
  {
    id: 'local-album-1',
    type: 'album',
    title: 'Chart Run',
    subtitle: 'Asake',
    image: 'assets/images/Album 6.png',
    detail: 'Album • New releases • Lytune editorial pick',
    tokens: ['album', 'asake', 'new releases']
  },
  {
    id: 'local-album-2',
    type: 'album',
    title: 'Late Checkout',
    subtitle: 'Ayra Starr',
    image: 'assets/images/Album 7.png',
    detail: 'Album • Ayra Starr • Summer-ready mood',
    tokens: ['album', 'ayra starr', 'pop']
  },
  {
    id: 'local-album-3',
    type: 'album',
    title: 'Summer Frequency',
    subtitle: 'Omah Lay',
    image: 'assets/images/Album 8.jpg',
    detail: 'Album • Omah Lay • Soft and melodic',
    tokens: ['album', 'omah lay', 'new releases']
  },
  {
    id: 'local-artist-1',
    type: 'artist',
    title: 'Burna Boy',
    subtitle: 'Artist',
    image: 'assets/artists/burnaboy.jpg',
    detail: 'Artist • Afrofusion heavyweight',
    tokens: ['artist', 'burna boy', 'afrobeats']
  },
  {
    id: 'local-artist-2',
    type: 'artist',
    title: 'Tems',
    subtitle: 'Artist',
    image: 'assets/artists/tems.png',
    detail: 'Artist • Soulful global voice',
    tokens: ['artist', 'tems', 'soul']
  },
  {
    id: 'local-artist-3',
    type: 'artist',
    title: 'Rema',
    subtitle: 'Artist',
    image: 'assets/artists/rema.jpg',
    detail: 'Artist • Afropop hitmaker',
    tokens: ['artist', 'rema', 'afropop']
  },
  {
    id: 'local-playlist-1',
    type: 'playlist',
    title: 'Afrobeats Pulse',
    subtitle: 'Lytune',
    image: 'assets/images/Album 11.png',
    detail: 'Playlist • Lytune • Big hooks and current favorites',
    tokens: ['playlist', 'afrobeats', 'mix']
  },
  {
    id: 'local-podcast-1',
    type: 'podcast',
    title: 'Behind the Beat',
    subtitle: 'Lytune Original',
    image: 'assets/images/Album 11.png',
    detail: 'Podcast • Music stories and artist conversation',
    tokens: ['podcast', 'talk', 'stories']
  },
  {
    id: 'local-podcast-2',
    type: 'podcast',
    title: 'Night Drive Talks',
    subtitle: 'Lytune Sessions',
    image: 'assets/images/Album 12.png',
    detail: 'Podcast • Chill reflections for late listening',
    tokens: ['podcast', 'night', 'talk']
  }
];

const LOCAL_PODCAST_CATALOG = [
  {
    id: 'local-podcast-1',
    title: 'Behind the Beat',
    publisher: 'Lytune Original',
    description: 'Conversations around modern music, creative process, and the stories behind breakout records.',
    image: 'assets/images/Album 11.png',
    category: 'Music Stories',
    meta: '24 min average',
    link: null
  },
  {
    id: 'local-podcast-2',
    title: 'Night Drive Talks',
    publisher: 'Lytune Sessions',
    description: 'Late-night reflections, calm interviews, and mood-driven listening for listeners winding down.',
    image: 'assets/images/Album 12.png',
    category: 'Chill Talk',
    meta: 'Weekly episodes',
    link: null
  },
  {
    id: 'local-podcast-3',
    title: 'Pulse Check',
    publisher: 'Lytune Editorial',
    description: 'Quick updates on trending artists, new drops, and the songs shaping the week on Lytune.',
    image: 'assets/images/Album 4.png',
    category: 'New Releases',
    meta: '15 min episodes',
    link: null
  },
  {
    id: 'local-podcast-4',
    title: 'Studio Notes',
    publisher: 'Creator Room',
    description: 'A closer look at recording sessions, production choices, and how favorite records come together.',
    image: 'assets/images/Album 6.png',
    category: 'Behind the Scenes',
    meta: 'Twice a month',
    link: null
  },
  {
    id: 'local-podcast-5',
    title: 'Soft Life Stories',
    publisher: 'Lytune Voices',
    description: 'Lifestyle, culture, and easy-flow conversation for listeners who want more than just music.',
    image: 'assets/images/Album 8.jpg',
    category: 'Culture',
    meta: '30 min average',
    link: null
  },
  {
    id: 'local-podcast-6',
    title: 'Mic Check Africa',
    publisher: 'Lytune Spotlight',
    description: 'Spotlighting African voices, scenes, and creators shaping the future of entertainment.',
    image: 'assets/images/Album 10.png',
    category: 'Spotlight',
    meta: 'Featured weekly',
    link: null
  }
];

const fetchDeezerList = async (path, limit = 10) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEEZER_TIMEOUT_MS);
  try {
    const deezerRes = await fetch(`https://api.deezer.com/${path}?limit=${limit}`, {
      signal: controller.signal
    });
    if (!deezerRes.ok) {
      throw new Error(`Deezer request failed for ${path}`);
    }
    const deezerData = await deezerRes.json();
    return deezerData.data || [];
  } finally {
    clearTimeout(timeout);
  }
};

const fetchJsonWithTimeout = async (url, timeoutMs = DEEZER_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const mapTrack = (track) => ({
  id: track.id,
  title: track.title,
  link: track.link,
  preview: track.preview,
  duration: track.duration || null,
  rank: track.rank || null,
  artist: {
    name: track.artist?.name || ''
  },
  album: {
    title: track.album?.title || '',
    cover_medium: track.album?.cover_medium || ''
  }
});

const mapAlbum = (album) => ({
  id: album.id,
  title: album.title,
  link: album.link,
  cover_medium: album.cover_medium,
  artist: {
    name: album.artist?.name || ''
  }
});

const mapArtist = (artist) => ({
  id: artist.id,
  name: artist.name,
  link: artist.link,
  picture_medium: artist.picture_medium
});

const mapPlaylist = (playlist) => ({
  id: playlist.id,
  title: playlist.title,
  link: playlist.link,
  picture_medium: playlist.picture_medium,
  user: {
    name: playlist.user?.name || ''
  }
});

const mapPodcast = (podcast) => ({
  id: podcast.id,
  title: podcast.title,
  link: podcast.link,
  picture_medium: podcast.picture_medium
});

const hasHomePayloadContent = (payload) =>
  Boolean(
    payload &&
      (
        payload.topTracks?.length ||
        payload.topAlbums?.length ||
        payload.topArtists?.length ||
        payload.topPlaylists?.length ||
        payload.topPodcasts?.length
      )
  );

const normalizeSearchValue = (value = '') =>
  (value ?? '')
    .toString()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const dedupeStrings = (values = []) => {
  const seen = new Set();

  return values.filter((value) => {
    const normalized = normalizeSearchValue(value);

    if (!normalized || seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
};

const formatDurationLabel = (value) => {
  const totalSeconds = Number.parseInt(value, 10);

  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return null;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const createSearchItem = ({
  id,
  type,
  title,
  subtitle,
  image,
  detail,
  link = null,
  tokens = [],
  source = 'local',
  preview = null,
  duration = null,
  albumTitle = ''
}) => ({
  id,
  type,
  title,
  subtitle,
  image: image || 'assets/images/logo.png',
  detail,
  link,
  tokens,
  source,
  preview: preview || null,
  duration: Number.isFinite(Number(duration)) ? Number(duration) : null,
  albumTitle: albumTitle || ''
});

const dedupeSearchItems = (items) => {
  const seen = new Set();

  return items.filter((item) => {
    const key = [
      item.type,
      normalizeSearchValue(item.title),
      normalizeSearchValue(item.subtitle)
    ].join('|');

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const dedupePodcastItems = (items) => {
  const seen = new Set();

  return items.filter((item) => {
    const key = [
      normalizeSearchValue(item.title),
      normalizeSearchValue(item.publisher)
    ].join('|');

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const scoreSearchItem = (item, query) => {
  if (!query) {
    return 1;
  }

  const normalizedTitle = normalizeSearchValue(item.title);
  const normalizedSubtitle = normalizeSearchValue(item.subtitle);
  const normalizedDetail = normalizeSearchValue(item.detail);
  const normalizedTokens = (item.tokens || []).map((token) => normalizeSearchValue(token));
  let score = 0;

  if (normalizedTitle === query) score += 160;
  if (normalizedSubtitle === query) score += 130;
  if (normalizedTokens.includes(query)) score += 90;
  if (normalizedTitle.startsWith(query)) score += 70;
  if (normalizedSubtitle.startsWith(query)) score += 55;
  if (normalizedTitle.includes(query)) score += 38;
  if (normalizedSubtitle.includes(query)) score += 28;
  if (normalizedDetail.includes(query)) score += 14;

  normalizedTokens.forEach((token) => {
    if (token.startsWith(query)) {
      score += 42;
      return;
    }

    if (token.includes(query)) {
      score += 20;
    }
  });

  return score;
};

const filterSearchItems = (items, query, filter) => {
  const normalizedQuery = normalizeSearchValue(query);
  const filteredItems = items.filter((item) => filter === 'all' || item.type === filter);

  if (!normalizedQuery) {
    return filteredItems;
  }

  return filteredItems
    .map((item) => ({
      item,
      score: scoreSearchItem(item, normalizedQuery)
    }))
    .filter((entry) => entry.score > 0)
    .sort((first, second) => second.score - first.score || first.item.title.localeCompare(second.item.title))
    .map((entry) => entry.item);
};

const createPodcastCard = ({
  id,
  title,
  publisher,
  description,
  image,
  category,
  meta,
  link = null,
  source = 'local'
}) => ({
  id,
  type: 'podcast',
  title,
  publisher,
  description,
  image: image || 'assets/images/logo.png',
  category,
  meta,
  link,
  source
});

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

const createContentRecord = ({
  id,
  type,
  title,
  subtitle,
  image,
  description,
  meta = [],
  link = null,
  source = 'local',
  artistName = '',
  albumTitle = '',
  playback = null,
  experience = null
}) => ({
  id,
  type,
  title,
  subtitle,
  image: image || 'assets/images/logo.png',
  description,
  meta: dedupeStrings(meta),
  link,
  source,
  artistName: artistName || subtitle || '',
  albumTitle: albumTitle || '',
  playback: playback
    ? {
        previewUrl: playback.previewUrl || null,
        available: Boolean(playback.previewUrl),
        durationSeconds: Number.isFinite(Number(playback.durationSeconds))
          ? Number(playback.durationSeconds)
          : null,
        durationLabel:
          playback.durationLabel || formatDurationLabel(playback.durationSeconds) || null,
        bpm: Number.isFinite(Number(playback.bpm)) ? Math.round(Number(playback.bpm)) : null,
        speedOptions:
          Array.isArray(playback.speedOptions) && playback.speedOptions.length
            ? playback.speedOptions
            : [0.85, 1, 1.15, 1.3, 1.5]
      }
    : null,
  experience:
    experience ||
    (type === 'track'
      ? {
          notePrompt: 'Capture the memory, room, or mood that made this song matter right now.',
          signature:
            'Lytune Moment keeps a personal note beside the song so the replay carries context too.'
        }
      : null)
});

const createContentRecordFromSearchItem = (item) =>
  createContentRecord({
    id: item.id,
    type: item.type,
    title: item.title,
    subtitle: item.subtitle,
    image: item.image,
    description:
      item.type === 'artist'
        ? `${item.title} is available inside Lytune so listeners can keep exploring without leaving the app.`
        : item.detail,
    meta: [
      formatContentTypeLabel(item.type),
      item.detail,
      item.type === 'track' ? formatDurationLabel(item.duration) : null,
      item.source === 'live' ? 'Live catalog' : 'Saved catalog'
    ],
    link: item.link || null,
    source: item.source,
    artistName: item.type === 'track' ? item.subtitle : item.title,
    albumTitle: item.albumTitle || '',
    playback:
      item.type === 'track'
        ? {
            previewUrl: item.preview || null,
            durationSeconds: item.duration || null,
            durationLabel: formatDurationLabel(item.duration),
            speedOptions: [0.85, 1, 1.15, 1.3, 1.5]
          }
        : null
  });

const createContentRecordFromPodcastCard = (show) =>
  createContentRecord({
    id: show.id,
    type: 'podcast',
    title: show.title,
    subtitle: show.publisher,
    image: show.image,
    description: show.description,
    meta: [
      show.category,
      show.meta,
      show.source === 'live' ? 'Live catalog' : 'Saved catalog'
    ],
    link: show.link || null,
    source: show.source
  });

const cloneValue = (value) => JSON.parse(JSON.stringify(value));

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
      note: 'Ayra Starr • Album • Started 18 minutes ago'
    },
    {
      contentId: 'local-track-4',
      category: 'music',
      note: 'Rema • Track • In heavy rotation this week'
    },
    {
      contentId: 'local-podcast-2',
      category: 'podcast',
      note: 'Lytune Sessions • Podcast • Picked back up last night'
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

const createDefaultLibraryProfile = (displayName = 'Guest Listener') => {
  const now = new Date().toISOString();
  const profile = cloneValue(LIBRARY_PROFILE_TEMPLATE);
  profile.displayName = displayName;
  profile.createdAt = now;
  profile.updatedAt = now;
  return profile;
};

const ensureDataDirectory = () => {
  if (!fs.existsSync(DATA_DIRECTORY)) {
    fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  }
};

const ensureLibraryStoreFile = () => {
  ensureDataDirectory();

  if (!fs.existsSync(LIBRARY_STORE_PATH)) {
    fs.writeFileSync(
      LIBRARY_STORE_PATH,
      JSON.stringify(createEmptyLibraryStore(), null, 2),
      'utf8'
    );
  }
};

const readLibraryStore = () => {
  ensureLibraryStoreFile();

  try {
    const rawValue = fs.readFileSync(LIBRARY_STORE_PATH, 'utf8');
    const parsedValue = JSON.parse(rawValue);

    if (!parsedValue || typeof parsedValue !== 'object' || !parsedValue.users) {
      throw new Error('Invalid library store shape.');
    }

    return parsedValue;
  } catch (error) {
    const fallbackStore = createEmptyLibraryStore();
    fs.writeFileSync(LIBRARY_STORE_PATH, JSON.stringify(fallbackStore, null, 2), 'utf8');
    return fallbackStore;
  }
};

const writeLibraryStore = (store) => {
  ensureDataDirectory();
  fs.writeFileSync(LIBRARY_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
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

  if (userContext.displayName && existingProfile.displayName !== userContext.displayName) {
    existingProfile.displayName = userContext.displayName;
    existingProfile.updatedAt = new Date().toISOString();
  }

  return { profile: existingProfile, created: false };
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

const buildHomePayload = async () => {
  const results = await Promise.allSettled([
    fetchDeezerList('chart/0/tracks', 10),
    fetchDeezerList('chart/0/albums', 10),
    fetchDeezerList('chart/0/artists', 6),
    fetchDeezerList('chart/0/playlists', 6),
    fetchDeezerList('chart/0/podcasts', 6)
  ]);

  const [tracks, albums, artists, playlists, podcasts] = results.map((result) =>
    result.status === 'fulfilled' ? result.value : []
  );

  return {
    topTracks: tracks.map(mapTrack),
    topAlbums: albums.map(mapAlbum),
    topArtists: artists.map(mapArtist),
    topPlaylists: playlists.map(mapPlaylist),
    topPodcasts: podcasts.map(mapPodcast)
  };
};

const getCachedHomePayload = async () => {
  const now = Date.now();
  if (deezerHomeCache.payload && deezerHomeCache.expiresAt > now) {
    return deezerHomeCache.payload;
  }

  const payload = await buildHomePayload();
  if (hasHomePayloadContent(payload)) {
    deezerHomeCache = {
      payload,
      expiresAt: now + HOME_CACHE_TTL_MS
    };
  }

  return payload;
};

const buildSearchCatalogFromHomePayload = (payload) => {
  if (!hasHomePayloadContent(payload)) {
    return [];
  }

  const trackItems = (payload.topTracks || []).map((track) =>
    createSearchItem({
      id: `track-${track.id}`,
      type: 'track',
      title: track.title || 'Untitled track',
      subtitle: track.artist?.name || 'Track',
      image: track.album?.cover_medium,
      detail: `Track • ${track.artist?.name || 'Unknown artist'}`,
      link: track.link || null,
      tokens: [track.artist?.name, 'track', 'song', 'music'],
      source: 'live',
      preview: track.preview || null,
      duration: track.duration || null,
      albumTitle: track.album?.title || ''
    })
  );

  const albumItems = (payload.topAlbums || []).map((album) =>
    createSearchItem({
      id: `album-${album.id}`,
      type: 'album',
      title: album.title || 'Untitled album',
      subtitle: album.artist?.name || 'Album',
      image: album.cover_medium,
      detail: `Album • ${album.artist?.name || 'Unknown artist'}`,
      link: album.link || null,
      tokens: [album.artist?.name, 'album', 'new releases'],
      source: 'live'
    })
  );

  const artistItems = (payload.topArtists || []).map((artist) =>
    createSearchItem({
      id: `artist-${artist.id}`,
      type: 'artist',
      title: artist.name || 'Unknown artist',
      subtitle: 'Artist',
      image: artist.picture_medium,
      detail: 'Artist • Trending on Lytune',
      link: artist.link || null,
      tokens: ['artist', artist.name, 'music'],
      source: 'live'
    })
  );

  const playlistItems = (payload.topPlaylists || []).map((playlist) =>
    createSearchItem({
      id: `playlist-${playlist.id}`,
      type: 'playlist',
      title: playlist.title || 'Playlist',
      subtitle: playlist.user?.name || 'Lytune',
      image: playlist.picture_medium,
      detail: `Playlist • ${playlist.user?.name || 'Curated on Lytune'}`,
      link: playlist.link || null,
      tokens: ['playlist', playlist.user?.name, 'mix'],
      source: 'live'
    })
  );

  const podcastItems = (payload.topPodcasts || []).map((podcast) =>
    createSearchItem({
      id: `podcast-${podcast.id}`,
      type: 'podcast',
      title: podcast.title || 'Podcast',
      subtitle: 'Podcast',
      image: podcast.picture_medium,
      detail: 'Podcast • Trending spoken content',
      link: podcast.link || null,
      tokens: ['podcast', 'talk', 'stories'],
      source: 'live'
    })
  );

  return dedupeSearchItems([
    ...trackItems,
    ...albumItems,
    ...artistItems,
    ...playlistItems,
    ...podcastItems
  ]);
};

const getSearchCatalog = async () => {
  const now = Date.now();
  if (searchCatalogCache.items.length && searchCatalogCache.expiresAt > now) {
    return searchCatalogCache;
  }

  let liveItems = [];
  let source = 'fallback';

  try {
    const homePayload = await getCachedHomePayload();
    liveItems = buildSearchCatalogFromHomePayload(homePayload);
    if (liveItems.length) {
      source = 'live';
    }
  } catch (error) {
    liveItems = [];
  }

  searchCatalogCache = {
    items: dedupeSearchItems([...liveItems, ...LOCAL_SEARCH_CATALOG]),
    source,
    expiresAt: now + SEARCH_CACHE_TTL_MS
  };

  return searchCatalogCache;
};

const fetchDeezerSearchList = async (type, query, limit = 8) => {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit)
  });
  const response = await fetchJsonWithTimeout(
    `https://api.deezer.com/search/${type}?${params.toString()}`,
    DEEZER_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(`Deezer search failed for ${type}.`);
  }

  const payload = await response.json();
  return payload.data || [];
};

const buildLiveQuerySearchItems = async (query, filter, limit) => {
  const endpointFilters =
    filter === 'all'
      ? ['track', 'artist', 'album', 'playlist']
      : ['track', 'artist', 'album', 'playlist'].includes(filter)
        ? [filter]
        : [];

  if (!endpointFilters.length) {
    return [];
  }

  const results = await Promise.allSettled(
    endpointFilters.map((entry) => fetchDeezerSearchList(entry, query, limit))
  );
  const liveItems = [];

  endpointFilters.forEach((entry, index) => {
    const result = results[index];

    if (result.status !== 'fulfilled') {
      return;
    }

    if (entry === 'track') {
      liveItems.push(
        ...result.value.map((track) =>
          createSearchItem({
            id: `track-${track.id}`,
            type: 'track',
            title: track.title || 'Untitled track',
            subtitle: track.artist?.name || 'Track',
            image: track.album?.cover_medium || track.album?.cover_big || track.album?.cover || '',
            detail: `Track • ${track.artist?.name || 'Unknown artist'}`,
            link: track.link || null,
            tokens: [track.artist?.name, track.album?.title, 'track', 'song', 'music'],
            source: 'live',
            preview: track.preview || null,
            duration: track.duration || null,
            albumTitle: track.album?.title || ''
          })
        )
      );
      return;
    }

    if (entry === 'album') {
      liveItems.push(
        ...result.value.map((album) =>
          createSearchItem({
            id: `album-${album.id}`,
            type: 'album',
            title: album.title || 'Untitled album',
            subtitle: album.artist?.name || 'Album',
            image: album.cover_medium || album.cover_big || album.cover || '',
            detail: `Album • ${album.artist?.name || 'Unknown artist'}`,
            link: album.link || null,
            tokens: [album.artist?.name, 'album', 'release', 'music'],
            source: 'live'
          })
        )
      );
      return;
    }

    if (entry === 'artist') {
      liveItems.push(
        ...result.value.map((artist) =>
          createSearchItem({
            id: `artist-${artist.id}`,
            type: 'artist',
            title: artist.name || 'Unknown artist',
            subtitle: 'Artist',
            image: artist.picture_medium || artist.picture_big || artist.picture || '',
            detail: 'Artist • Live on Deezer',
            link: artist.link || null,
            tokens: ['artist', artist.name, 'music'],
            source: 'live'
          })
        )
      );
      return;
    }

    if (entry === 'playlist') {
      liveItems.push(
        ...result.value.map((playlist) =>
          createSearchItem({
            id: `playlist-${playlist.id}`,
            type: 'playlist',
            title: playlist.title || 'Playlist',
            subtitle: playlist.user?.name || 'Lytune',
            image: playlist.picture_medium || playlist.picture_big || playlist.picture || '',
            detail: `Playlist • ${playlist.user?.name || 'Curated on Lytune'}`,
            link: playlist.link || null,
            tokens: ['playlist', playlist.user?.name, 'mix'],
            source: 'live'
          })
        )
      );
    }
  });

  return dedupeSearchItems(liveItems);
};

const buildPodcastCatalog = async () => {
  const now = Date.now();
  if (podcastCatalogCache.items.length && podcastCatalogCache.expiresAt > now) {
    return podcastCatalogCache;
  }

  let liveItems = [];
  let source = 'fallback';

  try {
    const podcasts = await fetchDeezerList('chart/0/podcasts', 12);
    liveItems = podcasts.map((podcast) =>
      createPodcastCard({
        id: `podcast-${podcast.id}`,
        title: podcast.title || 'Podcast',
        publisher: 'Trending on Deezer',
        description: podcast.description || 'Featured spoken content now available on Lytune.',
        image: podcast.picture_medium || podcast.picture_big || podcast.picture || 'assets/images/logo.png',
        category: 'Podcast',
        meta: Number.isFinite(podcast.fans)
          ? `${new Intl.NumberFormat('en-US').format(podcast.fans)} followers`
          : 'Featured show',
        link: podcast.link || null,
        source: 'live'
      })
    );

    if (liveItems.length) {
      source = 'live';
    }
  } catch (error) {
    liveItems = [];
  }

  podcastCatalogCache = {
    items: dedupePodcastItems([
      ...liveItems,
      ...LOCAL_PODCAST_CATALOG.map((podcast) => createPodcastCard(podcast))
    ]),
    source,
    expiresAt: now + PODCAST_CACHE_TTL_MS
  };

  return podcastCatalogCache;
};

const getContentCatalog = async () => {
  const [searchCatalog, podcastCatalog] = await Promise.all([
    getSearchCatalog(),
    buildPodcastCatalog()
  ]);
  const contentById = new Map();

  searchCatalog.items.forEach((item) => {
    contentById.set(item.id, createContentRecordFromSearchItem(item));
  });

  podcastCatalog.items.forEach((show) => {
    contentById.set(show.id, createContentRecordFromPodcastCard(show));
  });

  return Array.from(contentById.values());
};

const extractNumericContentId = (rawId, type = '') => {
  const value = (rawId || '').toString().trim();

  if (!value) {
    return null;
  }

  if (/^\d+$/.test(value)) {
    return value;
  }

  if (type) {
    const prefixedMatch = value.match(new RegExp(`^${type}-(\\d+)$`, 'i'));
    if (prefixedMatch) {
      return prefixedMatch[1];
    }
  }

  const fallbackMatch = value.match(/(\d+)$/);
  return fallbackMatch ? fallbackMatch[1] : null;
};

const fetchDeezerTrackDetail = async (trackId) => {
  const response = await fetchJsonWithTimeout(`https://api.deezer.com/track/${trackId}`);

  if (!response.ok) {
    throw new Error(`Unable to load Deezer track detail for ${trackId}.`);
  }

  return response.json();
};

const fetchLiveContentRecordFromDeezer = async (type, rawId) => {
  const numericId = extractNumericContentId(rawId, type);

  if (!numericId) {
    return null;
  }

  const response = await fetchJsonWithTimeout(`https://api.deezer.com/${type}/${numericId}`);

  if (!response.ok) {
    throw new Error(`Unable to load Deezer ${type} detail.`);
  }

  const payload = await response.json();

  if (!payload || !payload.id) {
    return null;
  }

  if (type === 'track') {
    return createContentRecord({
      id: `track-${payload.id}`,
      type: 'track',
      title: payload.title || 'Untitled track',
      subtitle: payload.artist?.name || 'Track',
      image: payload.album?.cover_medium || payload.album?.cover_big || payload.album?.cover || 'assets/images/logo.png',
      description: `Track • ${payload.artist?.name || 'Unknown artist'} • Live from Deezer`,
      meta: [
        'Song',
        payload.album?.title ? `From ${payload.album.title}` : null,
        formatDurationLabel(payload.duration),
        Number.isFinite(Number(payload.bpm)) ? `${Math.round(Number(payload.bpm))} BPM` : null,
        'Live catalog'
      ],
      link: payload.link || null,
      source: 'live',
      artistName: payload.artist?.name || '',
      albumTitle: payload.album?.title || '',
      playback: {
        previewUrl: payload.preview || null,
        durationSeconds: payload.duration || null,
        bpm: Number.isFinite(Number(payload.bpm)) ? Math.round(Number(payload.bpm)) : null,
        speedOptions: [0.85, 1, 1.15, 1.3, 1.5]
      }
    });
  }

  if (type === 'album') {
    return createContentRecord({
      id: `album-${payload.id}`,
      type: 'album',
      title: payload.title || 'Untitled album',
      subtitle: payload.artist?.name || 'Album',
      image: payload.cover_medium || payload.cover_big || payload.cover || 'assets/images/logo.png',
      description: `Album • ${payload.artist?.name || 'Unknown artist'} • Live from Deezer`,
      meta: [
        'Album',
        payload.release_date ? `Released ${payload.release_date}` : null,
        Number.isFinite(Number(payload.nb_tracks)) ? `${payload.nb_tracks} tracks` : null,
        'Live catalog'
      ],
      link: payload.link || null,
      source: 'live'
    });
  }

  if (type === 'artist') {
    return createContentRecord({
      id: `artist-${payload.id}`,
      type: 'artist',
      title: payload.name || 'Unknown artist',
      subtitle: 'Artist',
      image: payload.picture_medium || payload.picture_big || payload.picture || 'assets/images/logo.png',
      description: `${payload.name || 'This artist'} is available inside Lytune through the live Deezer catalog.`,
      meta: [
        'Artist',
        Number.isFinite(Number(payload.nb_fan))
          ? `${new Intl.NumberFormat('en-US').format(payload.nb_fan)} fans`
          : null,
        'Live catalog'
      ],
      link: payload.link || null,
      source: 'live'
    });
  }

  if (type === 'playlist') {
    return createContentRecord({
      id: `playlist-${payload.id}`,
      type: 'playlist',
      title: payload.title || 'Playlist',
      subtitle: payload.user?.name || 'Lytune',
      image: payload.picture_medium || payload.picture_big || payload.picture || 'assets/images/logo.png',
      description: payload.description || 'Playlist available through the live Deezer catalog.',
      meta: [
        'Playlist',
        Number.isFinite(Number(payload.nb_tracks)) ? `${payload.nb_tracks} tracks` : null,
        'Live catalog'
      ],
      link: payload.link || null,
      source: 'live'
    });
  }

  if (type === 'podcast') {
    return createContentRecord({
      id: `podcast-${payload.id}`,
      type: 'podcast',
      title: payload.title || 'Podcast',
      subtitle: 'Podcast',
      image: payload.picture_medium || payload.picture_big || payload.picture || 'assets/images/logo.png',
      description: payload.description || 'Podcast available through the live Deezer catalog.',
      meta: [
        'Podcast',
        Number.isFinite(Number(payload.fans))
          ? `${new Intl.NumberFormat('en-US').format(payload.fans)} followers`
          : null,
        'Live catalog'
      ],
      link: payload.link || null,
      source: 'live'
    });
  }

  return null;
};

const enrichTrackContentRecord = async (item) => {
  if (!item || item.type !== 'track') {
    return item;
  }

  const trackId = extractNumericContentId(item.id, 'track');
  const existingPlayback = item.playback || {};

  if (!trackId || item.source !== 'live') {
    return {
      ...item,
      meta: dedupeStrings([
        ...item.meta,
        existingPlayback.durationLabel ? `${existingPlayback.durationLabel} preview` : null,
        existingPlayback.previewUrl ? 'Preview ready in Lytune' : 'Preview not connected yet'
      ])
    };
  }

  try {
    const detail = await fetchDeezerTrackDetail(trackId);
    const durationSeconds = Number.isFinite(Number(detail.duration))
      ? Number(detail.duration)
      : existingPlayback.durationSeconds || null;
    const durationLabel =
      formatDurationLabel(durationSeconds) || existingPlayback.durationLabel || null;
    const bpm = Number.isFinite(Number(detail.bpm)) ? Math.round(Number(detail.bpm)) : null;
    const rank = Number.isFinite(Number(detail.rank)) ? Number(detail.rank) : null;

    return {
      ...item,
      subtitle: detail.artist?.name || item.subtitle,
      artistName: detail.artist?.name || item.artistName || item.subtitle,
      albumTitle: detail.album?.title || item.albumTitle || '',
      meta: dedupeStrings([
        ...item.meta,
        detail.album?.title ? `From ${detail.album.title}` : null,
        durationLabel ? `${durationLabel} preview` : null,
        bpm ? `${bpm} BPM` : null,
        rank ? `${new Intl.NumberFormat('en-US').format(rank)} track rank` : null
      ]),
      playback: {
        ...existingPlayback,
        previewUrl: existingPlayback.previewUrl || detail.preview || null,
        available: Boolean(existingPlayback.previewUrl || detail.preview),
        durationSeconds,
        durationLabel,
        bpm,
        rank,
        speedOptions:
          existingPlayback.speedOptions && existingPlayback.speedOptions.length
            ? existingPlayback.speedOptions
            : [0.85, 1, 1.15, 1.3, 1.5]
      }
    };
  } catch (error) {
    return {
      ...item,
      meta: dedupeStrings([
        ...item.meta,
        existingPlayback.durationLabel ? `${existingPlayback.durationLabel} preview` : null,
        existingPlayback.previewUrl ? 'Preview ready in Lytune' : 'Preview not connected yet'
      ])
    };
  }
};

const parseSyncedLyrics = (value = '') =>
  value
    .toString()
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/);

      if (!match) {
        return null;
      }

      const minutes = Number.parseInt(match[1], 10);
      const seconds = Number.parseInt(match[2], 10);
      const milliseconds = Number.parseInt((match[3] || '0').padEnd(3, '0'), 10);
      const text = match[4].trim();

      if (!text) {
        return null;
      }

      return {
        time: Number((minutes * 60 + seconds + milliseconds / 1000).toFixed(2)),
        text
      };
    })
    .filter(Boolean);

const fetchLyricsForTrack = async (track) => {
  const title = (track?.title || '').toString().trim();
  const artistName = (track?.artistName || track?.subtitle || '').toString().trim();
  const albumTitle = (track?.albumTitle || '').toString().trim();
  const durationSeconds = Number.parseInt(track?.playback?.durationSeconds, 10);

  if (!title || !artistName) {
    return {
      status: 'unavailable',
      provider: 'LRCLIB',
      synced: false,
      lines: [],
      message: 'Lyrics need both a title and artist before they can be looked up.'
    };
  }

  const cacheKey = [
    normalizeSearchValue(title),
    normalizeSearchValue(artistName),
    normalizeSearchValue(albumTitle)
  ].join('|');
  const cachedLyrics = lyricsCache.get(cacheKey);

  if (cachedLyrics && cachedLyrics.expiresAt > Date.now()) {
    return cachedLyrics.payload;
  }

  const params = new URLSearchParams({
    track_name: title,
    artist_name: artistName
  });

  if (albumTitle) {
    params.set('album_name', albumTitle);
  }

  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    params.set('duration', String(durationSeconds));
  }

  const finalizeLyricsPayload = (payload) => {
    lyricsCache.set(cacheKey, {
      expiresAt: Date.now() + LYRICS_CACHE_TTL_MS,
      payload
    });
    return payload;
  };

  try {
    const response = await fetchJsonWithTimeout(
      `https://lrclib.net/api/get?${params.toString()}`,
      4500
    );

    if (response.status === 404) {
      return finalizeLyricsPayload({
        status: 'unavailable',
        provider: 'LRCLIB',
        synced: false,
        lines: [],
        message: 'Lyrics are not available for this song yet.'
      });
    }

    if (!response.ok) {
      throw new Error(`Lyrics request failed: ${response.status}`);
    }

    const lyricsData = await response.json();
    const syncedLines = parseSyncedLyrics(lyricsData.syncedLyrics || '');
    const plainLines = (lyricsData.plainLyrics || '')
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text) => ({
        time: null,
        text
      }));
    const lines = syncedLines.length ? syncedLines : plainLines;

    return finalizeLyricsPayload({
      status: lines.length ? 'available' : 'unavailable',
      provider: 'LRCLIB',
      synced: syncedLines.length > 0,
      language: lyricsData.lang || null,
      lines,
      message: lyricsData.instrumental
        ? 'This track is marked as instrumental.'
        : lines.length
          ? 'Lyrics loaded for this song.'
          : 'Lyrics were found, but no displayable lines came back yet.'
    });
  } catch (error) {
    return finalizeLyricsPayload({
      status: 'unavailable',
      provider: 'LRCLIB',
      synced: false,
      lines: [],
      message: 'Lyrics could not be loaded right now.'
    });
  }
};

const resolveContentIdCandidates = (rawId, type) => {
  const value = (rawId || '').toString().trim();
  const candidates = new Set();

  if (!value) {
    return [];
  }

  candidates.add(value);

  if (/^\d+$/.test(value) && type) {
    candidates.add(`${type}-${value}`);
  }

  return Array.from(candidates);
};

const getRelatedContentItems = (catalog, currentItem, limit = 4) => {
  const exactTypeMatches = catalog.filter(
    (item) => item.id !== currentItem.id && item.type === currentItem.type
  );

  const subtitleMatches = catalog.filter(
    (item) =>
      item.id !== currentItem.id &&
      item.type !== currentItem.type &&
      normalizeSearchValue(item.subtitle) === normalizeSearchValue(currentItem.subtitle)
  );

  const fallbackMatches = catalog.filter(
    (item) => item.id !== currentItem.id && item.type !== currentItem.type
  );

  return dedupeSearchItems(
    [...exactTypeMatches, ...subtitleMatches, ...fallbackMatches].map((item) => ({
      type: item.type,
      title: item.title,
      subtitle: item.subtitle,
      id: item.id
    }))
  )
    .map((entry) => catalog.find((item) => item.id === entry.id))
    .filter(Boolean)
    .slice(0, limit);
};

app.get('/api/deezer/home', async (req, res) => {
  try {
    const payload = await getCachedHomePayload();
    if (!hasHomePayloadContent(payload)) {
      return res.status(502).json({ error: 'Unable to fetch data from Deezer.' });
    }

    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load Deezer home data.' });
  }
});

app.get('/api/deezer/popular', async (req, res) => {
  const limitRaw = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 25)
    : 10;

  try {
    const tracks = (await fetchDeezerList('chart/0/tracks', limit)).map(mapTrack);

    return res.json({ data: tracks });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load Deezer chart data.' });
  }
});

app.get('/api/search', async (req, res) => {
  const query = (req.query.query || '').toString().trim();
  const requestedFilter = (req.query.filter || 'all').toString().trim().toLowerCase();
  const limitRaw = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 20)
    : 8;
  const allowedFilters = new Set(['all', 'track', 'artist', 'album', 'podcast', 'playlist']);
  const filter = allowedFilters.has(requestedFilter) ? requestedFilter : 'all';

  try {
    const { items, source } = await getSearchCatalog();
    let filteredResults = filterSearchItems(items, query, filter);
    let responseSource = source;

    if (query) {
      try {
        const liveQueryItems = await buildLiveQuerySearchItems(query, filter, limit);

        if (liveQueryItems.length) {
          filteredResults = filterSearchItems(
            dedupeSearchItems([...liveQueryItems, ...filteredResults]),
            query,
            filter
          );
          responseSource = 'live';
        }
      } catch (error) {
        filteredResults = filterSearchItems(items, query, filter);
      }
    }

    return res.json({
      query,
      filter,
      source: responseSource,
      total: filteredResults.length,
      data: filteredResults.slice(0, limit)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load search results.' });
  }
});

app.get('/api/deezer/podcasts', async (req, res) => {
  const limitRaw = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 12)
    : 8;

  try {
    const { items, source } = await buildPodcastCatalog();
    const data = items.slice(0, limit);

    return res.json({
      source,
      featured: data[0] || null,
      data
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load podcast data.' });
  }
});

app.get('/api/content-detail', async (req, res) => {
  const requestedId = (req.query.id || '').toString().trim();
  const requestedType = (req.query.type || '').toString().trim().toLowerCase();

  if (!requestedId) {
    return res.status(400).json({ error: 'Missing id query parameter.' });
  }

  try {
    const catalog = await getContentCatalog();
    const candidateIds = resolveContentIdCandidates(requestedId, requestedType);
    let item = catalog.find((entry) => candidateIds.includes(entry.id));

    if (!item && requestedType) {
      try {
        item = await fetchLiveContentRecordFromDeezer(requestedType, requestedId);
      } catch (error) {
        item = null;
      }
    }

    if (!item) {
      return res.status(404).json({ error: 'Content not found.' });
    }

    const enrichedItem = item.type === 'track' ? await enrichTrackContentRecord(item) : item;
    const related = getRelatedContentItems(catalog, enrichedItem);

    return res.json({
      data: enrichedItem,
      related
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load content detail.' });
  }
});

app.get('/api/lyrics', async (req, res) => {
  const requestedId = (req.query.id || '').toString().trim();
  const requestedType = (req.query.type || '').toString().trim().toLowerCase();

  if (!requestedId) {
    return res.status(400).json({ error: 'Missing id query parameter.' });
  }

  try {
    const catalog = await getContentCatalog();
    const candidateIds = resolveContentIdCandidates(requestedId, requestedType);
    const item = catalog.find((entry) => candidateIds.includes(entry.id));

    if (!item) {
      return res.status(404).json({ error: 'Content not found.' });
    }

    if (item.type !== 'track') {
      return res.json({
        status: 'unsupported',
        provider: null,
        synced: false,
        lines: [],
        message: 'Lyrics are currently available for songs only.'
      });
    }

    const enrichedItem = await enrichTrackContentRecord(item);
    const lyrics = await fetchLyricsForTrack(enrichedItem);

    return res.json({
      ...lyrics,
      contentId: enrichedItem.id,
      title: enrichedItem.title,
      artistName: enrichedItem.artistName || enrichedItem.subtitle
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load lyrics.' });
  }
});

app.get('/api/library', async (req, res) => {
  try {
    const userContext = resolveLibraryUser(req);
    const store = readLibraryStore();
    const { profile, created } = getOrCreateLibraryProfile(store, userContext);

    if (created) {
      writeLibraryStore(store);
    }

    const catalog = await getContentCatalog();

    return res.json({
      source: 'file',
      user: {
        key: userContext.key,
        displayName: profile.displayName || userContext.displayName
      },
      data: buildLibraryPayload(profile, catalog)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load library data.' });
  }
});

app.post('/api/library/toggle', async (req, res) => {
  const rawContentId = (req.body?.contentId || '').toString().trim();
  const requestedType = (req.body?.type || '').toString().trim().toLowerCase();

  if (!rawContentId) {
    return res.status(400).json({ error: 'Missing contentId in request body.' });
  }

  try {
    const catalog = await getContentCatalog();
    const candidateIds = resolveContentIdCandidates(rawContentId, requestedType);
    const content = catalog.find((entry) => candidateIds.includes(entry.id));

    if (!content) {
      return res.status(404).json({ error: 'Library item not found in content catalog.' });
    }

    const userContext = resolveLibraryUser(req);
    const store = readLibraryStore();
    const { profile } = getOrCreateLibraryProfile(store, userContext);
    const savedItemIds = new Set(profile.savedItemIds || []);
    const wasSaved = savedItemIds.has(content.id);

    if (wasSaved) {
      savedItemIds.delete(content.id);
      profile.pinned = (profile.pinned || []).filter((entry) => entry.contentId !== content.id);

      if (content.type === 'artist') {
        profile.creators = (profile.creators || []).filter((entry) => entry.contentId !== content.id);
        profile.summary.followingCount = Math.max((profile.summary?.followingCount || 1) - 1, 0);
      }

      profile.summary.savedCount = Math.max((profile.summary?.savedCount || 1) - 1, 0);
    } else {
      savedItemIds.add(content.id);
      profile.summary.savedCount = Math.max(
        savedItemIds.size,
        (profile.summary?.savedCount || savedItemIds.size) + 1
      );

      if (content.type === 'artist') {
        profile.creators = [
          createLibraryEntryFromContent(
            content,
            `${content.title} is now part of your followed creators on Lytune.`,
            'Following'
          ),
          ...(profile.creators || []).filter((entry) => entry.contentId !== content.id)
        ].slice(0, 4);

        profile.summary.followingCount = (profile.summary?.followingCount || 0) + 1;
      } else {
        profile.pinned = [
          createLibraryEntryFromContent(
            content,
            `${content.title} was saved into your Lytune library.`,
            formatContentTypeLabel(content.type)
          ),
          ...(profile.pinned || []).filter((entry) => entry.contentId !== content.id)
        ].slice(0, 4);
      }
    }

    profile.savedItemIds = Array.from(savedItemIds);
    profile.updatedAt = new Date().toISOString();
    writeLibraryStore(store);

    return res.json({
      success: true,
      saved: !wasSaved,
      user: {
        key: userContext.key,
        displayName: profile.displayName || userContext.displayName
      },
      data: buildLibraryPayload(profile, catalog)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to update library state.' });
  }
});

app.get('/api/me', (req, res) => {
  try {
    const userContext = resolveLibraryUser(req);
    const store = readLibraryStore();
    const { profile, created } = getOrCreateLibraryProfile(store, userContext);

    if (created) {
      writeLibraryStore(store);
    }

    updateSummaryFromProfile(profile);

    return res.json({
      source: 'file',
      data: {
        key: userContext.key,
        displayName: profile.displayName || userContext.displayName,
        summary: profile.summary,
        downloadSummary: profile.downloads?.summary || null,
        playlistCount: (profile.playlists || []).length
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load user profile.' });
  }
});

app.get('/api/downloads', async (req, res) => {
  try {
    const userContext = resolveLibraryUser(req);
    const store = readLibraryStore();
    const { profile, created } = getOrCreateLibraryProfile(store, userContext);

    if (created) {
      writeLibraryStore(store);
    }

    updateSummaryFromProfile(profile);
    const catalog = await getContentCatalog();

    return res.json({
      source: 'file',
      user: {
        key: userContext.key,
        displayName: profile.displayName || userContext.displayName
      },
      data: buildDownloadsPayload(profile, catalog)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load downloads data.' });
  }
});

app.post('/api/downloads/toggle', async (req, res) => {
  const rawContentId = (req.body?.contentId || '').toString().trim();
  const requestedType = (req.body?.type || '').toString().trim().toLowerCase();

  if (!rawContentId) {
    return res.status(400).json({ error: 'Missing contentId in request body.' });
  }

  try {
    const catalog = await getContentCatalog();
    const candidateIds = resolveContentIdCandidates(rawContentId, requestedType);
    const content = catalog.find((entry) => candidateIds.includes(entry.id));

    if (!content) {
      return res.status(404).json({ error: 'Download item not found in content catalog.' });
    }

    const userContext = resolveLibraryUser(req);
    const store = readLibraryStore();
    const { profile } = getOrCreateLibraryProfile(store, userContext);
    profile.downloads = profile.downloads || {};
    profile.downloads.ready = profile.downloads.ready || [];
    profile.downloads.queue = profile.downloads.queue || [];

    const readyIndex = profile.downloads.ready.findIndex((entry) => entry.contentId === content.id);
    let downloaded = false;

    if (readyIndex >= 0) {
      profile.downloads.ready.splice(readyIndex, 1);
      downloaded = false;
    } else {
      profile.downloads.ready.unshift({
        contentId: content.id,
        category: getLibraryCategoryForType(content.type),
        tag: `${formatContentTypeLabel(content.type)} - Offline`,
        note: `${content.subtitle || 'Lytune'} - Saved for offline use`
      });
      profile.downloads.ready = profile.downloads.ready.slice(0, 8);
      profile.downloads.queue = (profile.downloads.queue || []).filter((entry) => entry.contentId !== content.id);
      downloaded = true;
    }

    updateSummaryFromProfile(profile);
    profile.updatedAt = new Date().toISOString();
    writeLibraryStore(store);

    return res.json({
      success: true,
      downloaded,
      data: buildDownloadsPayload(profile, catalog)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to update downloads state.' });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const userContext = resolveLibraryUser(req);
    const store = readLibraryStore();
    const { profile, created } = getOrCreateLibraryProfile(store, userContext);

    if (created) {
      writeLibraryStore(store);
    }

    const catalog = await getContentCatalog();

    return res.json({
      source: 'file',
      user: {
        key: userContext.key,
        displayName: profile.displayName || userContext.displayName
      },
      data: buildHistoryPayload(profile, catalog)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load history data.' });
  }
});

app.post('/api/history/add', async (req, res) => {
  const rawContentId = (req.body?.contentId || '').toString().trim();
  const requestedType = (req.body?.type || '').toString().trim().toLowerCase();

  if (!rawContentId) {
    return res.status(400).json({ error: 'Missing contentId in request body.' });
  }

  try {
    const catalog = await getContentCatalog();
    const candidateIds = resolveContentIdCandidates(rawContentId, requestedType);
    const content = catalog.find((entry) => candidateIds.includes(entry.id));

    if (!content) {
      return res.status(404).json({ error: 'History item not found in content catalog.' });
    }

    const userContext = resolveLibraryUser(req);
    const store = readLibraryStore();
    const { profile } = getOrCreateLibraryProfile(store, userContext);
    const playedAt = new Date().toISOString();
    const note = formatHistoryNote(content, 'Played moments ago');
    profile.history = [
      {
        contentId: content.id,
        note,
        playedAt
      },
      ...(profile.history || []).filter((entry) => entry.contentId !== content.id)
    ].slice(0, 12);

    updateRecentFromHistory(profile, content, note);
    updateSummaryFromProfile(profile);
    profile.updatedAt = playedAt;
    writeLibraryStore(store);

    return res.json({
      success: true,
      data: buildHistoryPayload(profile, catalog)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to update history.' });
  }
});

app.get('/api/moments', async (req, res) => {
  const contentId = (req.query.contentId || '').toString().trim();

  if (!contentId) {
    return res.status(400).json({ error: 'Missing contentId query parameter.' });
  }

  try {
    const userContext = resolveLibraryUser(req);
    const store = readLibraryStore();
    const { profile, created } = getOrCreateLibraryProfile(store, userContext);
    profile.moments = profile.moments || {};

    if (created) {
      writeLibraryStore(store);
    }

    return res.json({
      source: 'file',
      data: buildMomentPayload(profile, contentId)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load your saved Lytune Moment.' });
  }
});

app.post('/api/moments/upsert', async (req, res) => {
  const contentId = (req.body?.contentId || '').toString().trim();
  const mood = (req.body?.mood || '').toString().trim().slice(0, 60);
  const note = (req.body?.note || '').toString().trim().slice(0, 400);

  if (!contentId) {
    return res.status(400).json({ error: 'Missing contentId in request body.' });
  }

  try {
    const userContext = resolveLibraryUser(req);
    const store = readLibraryStore();
    const { profile } = getOrCreateLibraryProfile(store, userContext);
    const updatedAt = new Date().toISOString();

    profile.moments = profile.moments || {};

    if (!mood && !note) {
      delete profile.moments[contentId];
    } else {
      profile.moments[contentId] = {
        mood,
        note,
        updatedAt
      };
    }

    profile.updatedAt = updatedAt;
    writeLibraryStore(store);

    return res.json({
      source: 'file',
      data: buildMomentPayload(profile, contentId)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to save your Lytune Moment.' });
  }
});

app.get('/api/playlists', async (req, res) => {
  try {
    const userContext = resolveLibraryUser(req);
    const store = readLibraryStore();
    const { profile, created } = getOrCreateLibraryProfile(store, userContext);

    if (created) {
      writeLibraryStore(store);
    }

    const catalog = await getContentCatalog();

    return res.json({
      source: 'file',
      user: {
        key: userContext.key,
        displayName: profile.displayName || userContext.displayName
      },
      data: buildPlaylistsPayload(profile, catalog)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load playlists.' });
  }
});

app.post('/api/playlists/create', async (req, res) => {
  const title = (req.body?.title || '').toString().trim();
  const description = (req.body?.description || '').toString().trim();
  const rawContentId = (req.body?.contentId || '').toString().trim();
  const requestedType = (req.body?.type || '').toString().trim().toLowerCase();

  if (!title) {
    return res.status(400).json({ error: 'Missing playlist title.' });
  }

  try {
    const catalog = await getContentCatalog();
    let initialContent = null;

    if (rawContentId) {
      const candidateIds = resolveContentIdCandidates(rawContentId, requestedType);
      initialContent = catalog.find((entry) => candidateIds.includes(entry.id));

      if (!initialContent) {
        return res.status(404).json({ error: 'Playlist seed item was not found in content catalog.' });
      }
    }

    const userContext = resolveLibraryUser(req);
    const store = readLibraryStore();
    const { profile } = getOrCreateLibraryProfile(store, userContext);
    profile.playlists = profile.playlists || [];
    const updatedAt = new Date().toISOString();

    const playlist = {
      id: `playlist-user-${Date.now()}`,
      title,
      description: description || 'A new playlist created inside Lytune.',
      coverImage: initialContent?.image || 'assets/images/Album 11.png',
      itemIds: initialContent ? [initialContent.id] : [],
      updatedAt
    };

    profile.playlists.unshift(playlist);
    profile.updatedAt = updatedAt;
    writeLibraryStore(store);

    return res.status(201).json({
      success: true,
      createdPlaylistId: playlist.id,
      data: buildPlaylistsPayload(profile, catalog)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to create playlist.' });
  }
});

app.post('/api/playlists/add-item', async (req, res) => {
  const playlistId = (req.body?.playlistId || '').toString().trim();
  const rawContentId = (req.body?.contentId || '').toString().trim();
  const requestedType = (req.body?.type || '').toString().trim().toLowerCase();

  if (!playlistId) {
    return res.status(400).json({ error: 'Missing playlistId in request body.' });
  }

  if (!rawContentId) {
    return res.status(400).json({ error: 'Missing contentId in request body.' });
  }

  try {
    const catalog = await getContentCatalog();
    const candidateIds = resolveContentIdCandidates(rawContentId, requestedType);
    const content = catalog.find((entry) => candidateIds.includes(entry.id));

    if (!content) {
      return res.status(404).json({ error: 'Playlist item was not found in content catalog.' });
    }

    const userContext = resolveLibraryUser(req);
    const store = readLibraryStore();
    const { profile } = getOrCreateLibraryProfile(store, userContext);
    profile.playlists = profile.playlists || [];

    const playlist = profile.playlists.find((entry) => entry.id === playlistId);

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found.' });
    }

    playlist.itemIds = playlist.itemIds || [];
    const alreadyPresent = playlist.itemIds.includes(content.id);

    if (!alreadyPresent) {
      playlist.itemIds.unshift(content.id);
    }

    if (!playlist.coverImage || playlist.coverImage === 'assets/images/Album 11.png') {
      playlist.coverImage = content.image || playlist.coverImage;
    }

    const updatedAt = new Date().toISOString();
    playlist.updatedAt = updatedAt;
    profile.updatedAt = updatedAt;
    writeLibraryStore(store);

    return res.json({
      success: true,
      added: !alreadyPresent,
      playlistId: playlist.id,
      data: buildPlaylistsPayload(profile, catalog)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to add item to playlist.' });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const userContext = resolveLibraryUser(req);
    const store = readLibraryStore();
    const { profile, created } = getOrCreateLibraryProfile(store, userContext);

    if (created) {
      writeLibraryStore(store);
    }

    const [catalog, homePayload] = await Promise.all([
      getContentCatalog(),
      getCachedHomePayload().catch(() => ({
        topTracks: [],
        topAlbums: [],
        topArtists: [],
        topPlaylists: [],
        topPodcasts: []
      }))
    ]);

    updateSummaryFromProfile(profile);

    return res.json({
      source: hasHomePayloadContent(homePayload) ? 'live' : 'fallback',
      user: {
        key: userContext.key,
        displayName: profile.displayName || userContext.displayName
      },
      library: buildLibraryPayload(profile, catalog),
      downloads: buildDownloadsPayload(profile, catalog),
      history: buildHistoryPayload(profile, catalog),
      playlists: buildPlaylistsPayload(profile, catalog),
      deezer: {
        freshTracks: (homePayload.topTracks || []).slice(0, 4),
        freshAlbums: (homePayload.topAlbums || []).slice(0, 4),
        freshArtists: (homePayload.topArtists || []).slice(0, 4),
        freshPlaylists: (homePayload.topPlaylists || []).slice(0, 4),
        freshPodcasts: (homePayload.topPodcasts || []).slice(0, 4)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load dashboard data.' });
  }
});

app.get('/api/artist-image', async (req, res) => {
  const name = (req.query.name || '').toString().trim();

  if (!name) {
    return res.status(400).json({ error: 'Missing name query parameter.' });
  }
  if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    return res.status(503).json({ error: 'Server missing GOOGLE_API_KEY or GOOGLE_CX.' });
  }

  try {
    const query = `${name} singer artist portrait`;
    const params = new URLSearchParams({
      key: GOOGLE_API_KEY,
      cx: GOOGLE_CX,
      q: query,
      searchType: 'image',
      num: '1',
      safe: 'active'
    });
    const googleRes = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`);
    if (!googleRes.ok) {
      const googleError = await googleRes.text();
      // Fallback so users still see images if Google API setup/quota is wrong.
      const wikiRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`);
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        const wikiImage = wikiData.thumbnail?.source || wikiData.originalimage?.source;
        if (wikiImage) {
          return res.json({ imageUrl: wikiImage, source: 'wikipedia_fallback' });
        }
      }
      return res.status(googleRes.status).json({
        error: 'Google image search request failed.',
        details: googleError
      });
    }

    const data = await googleRes.json();
    const imageUrl = data.items?.[0]?.link;
    if (!imageUrl) {
      const wikiRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`);
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        const wikiImage = wikiData.thumbnail?.source || wikiData.originalimage?.source;
        if (wikiImage) {
          return res.json({ imageUrl: wikiImage, source: 'wikipedia_fallback' });
        }
      }
      return res.status(404).json({ error: 'No image found for this artist.' });
    }

    return res.json({ imageUrl, source: 'google' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch artist image.' });
  }
});

const getAuthTokenFromRequest = (req) => {
  const authorizationHeader = req.get('authorization') || '';

  if (authorizationHeader.toLowerCase().startsWith('bearer ')) {
    return authorizationHeader.slice(7).trim();
  }

  return (
    req.get('x-lytune-auth-token') ||
    req.body?.token ||
    req.query?.token ||
    null
  );
};

const handleLocalSignup = (req, res) => {
  const email = normalizeAuthEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const username = req.body?.username;

  if (!isValidAuthEmail(email)) {
    return res.status(400).json({
      success: false,
      message: 'Enter a valid email address.'
    });
  }

  if (!isValidAuthPassword(password)) {
    return res.status(400).json({
      success: false,
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`
    });
  }

  const store = readAuthStore();
  const existingUser = store.users[email];

  if (existingUser) {
    return res.status(409).json({
      success: false,
      message:
        existingUser.providers?.includes('google') && !existingUser.passwordHash
          ? 'This email is already linked to Google sign-in. Continue with Google instead.'
          : 'An account already exists with this email. Log in instead.'
    });
  }

  const user = createLocalAuthUser({
    email,
    password,
    username
  });
  store.users[email] = user;
  const token = createAuthSession(store, user);
  writeAuthStore(store);

  return res.status(201).json({
    success: true,
    message: 'Account created successfully.',
    token,
    user: buildPublicAuthUser(user, 'local')
  });
};

const handleLocalLogin = (req, res) => {
  const email = normalizeAuthEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const store = readAuthStore();
  const user = store.users[email];

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Incorrect email or password.'
    });
  }

  if (!user.passwordHash || !user.passwordSalt) {
    return res.status(400).json({
      success: false,
      message: user.providers?.includes('google')
        ? 'This account uses Google sign-in. Continue with Google instead.'
        : 'This account does not have a password yet.'
    });
  }

  if (!verifyLocalPassword(user, password)) {
    return res.status(401).json({
      success: false,
      message: 'Incorrect email or password.'
    });
  }

  const token = createAuthSession(store, user);
  writeAuthStore(store);

  return res.json({
    success: true,
    message: 'Login successful.',
    token,
    user: buildPublicAuthUser(user, 'local')
  });
};

app.post('/api/auth/signup', handleLocalSignup);
app.post('/api/auth/login', handleLocalLogin);
app.post('/login', handleLocalLogin);

app.get('/api/auth/status', (req, res) => {
  return res.json({
    success: true,
    version: 'local-auth-v1',
    capabilities: ['signup', 'login', 'logout', 'profile', 'google']
  });
});

app.get('/api/auth/me', (req, res) => {
  const authState = resolveAuthSession(getAuthTokenFromRequest(req));

  if (!authState.user) {
    return res.status(401).json({
      success: false,
      message: 'You are not signed in.'
    });
  }

  return res.json({
    success: true,
    user: buildPublicAuthUser(authState.user)
  });
});

app.post('/api/auth/logout', (req, res) => {
  const authState = resolveAuthSession(getAuthTokenFromRequest(req));

  if (!authState.user || !authState.store || !authState.sessionKey) {
    return res.status(401).json({
      success: false,
      message: 'You are not signed in.'
    });
  }

  clearAuthSession(authState.store, authState.sessionKey);
  writeAuthStore(authState.store);

  return res.json({
    success: true,
    message: 'Signed out successfully.'
  });
});

app.patch('/api/auth/profile', (req, res) => {
  const authState = resolveAuthSession(getAuthTokenFromRequest(req));

  if (!authState.user || !authState.store) {
    return res.status(401).json({
      success: false,
      message: 'You are not signed in.'
    });
  }

  try {
    updateAuthUserProfile(authState.user, req.body || {});
    writeAuthStore(authState.store);

    return res.json({
      success: true,
      message: 'Profile updated successfully.',
      user: buildPublicAuthUser(authState.user)
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Unable to update profile.'
    });
  }
});

app.get('/api/auth/google/config', (req, res) => {
  res.json({
    enabled: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
    clientId: GOOGLE_CLIENT_ID || null
  });
});

const normalizeAuthOrigin = (value) => {
  if (!value) {
    return null;
  }

  try {
    const parsedUrl = new URL(value);

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null;
    }

    return parsedUrl.origin;
  } catch (error) {
    return null;
  }
};

const exchangeGoogleCodeForTokens = async (code, redirectUri) => {
  const params = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const rawBody = await response.text();
  let payload = {};

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      payload = { error: 'invalid_json', rawBody };
    }
  }

  if (!response.ok) {
    const message = payload.error_description || payload.error || 'Google token exchange failed.';
    const exchangeError = new Error(message);
    exchangeError.status = response.status;
    exchangeError.details = payload;
    throw exchangeError;
  }

  return payload;
};

const fetchGoogleUserProfile = async (accessToken) => {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const rawBody = await response.text();
  let payload = {};

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      payload = { error: 'invalid_json', rawBody };
    }
  }

  if (!response.ok) {
    const message = payload.error_description || payload.error || 'Failed to fetch Google profile.';
    const profileError = new Error(message);
    profileError.status = response.status;
    profileError.details = payload;
    throw profileError;
  }

  return payload;
};

app.post('/api/auth/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({
      success: false,
      message: 'Google sign-in is not configured on the server.'
    });
  }

  const { code } = req.body || {};
  const redirectUri = normalizeAuthOrigin(req.body?.redirectUri);
  const requestOrigin = normalizeAuthOrigin(req.get('origin'));

  if (!code) {
    return res.status(400).json({
      success: false,
      message: 'Missing Google authorization code.'
    });
  }

  if (!redirectUri) {
    return res.status(400).json({
      success: false,
      message: 'Missing or invalid Google redirect origin.'
    });
  }

  if (requestOrigin && requestOrigin !== redirectUri) {
    return res.status(403).json({
      success: false,
      message: 'Google sign-in origin mismatch.'
    });
  }

  try {
    const tokens = await exchangeGoogleCodeForTokens(code, redirectUri);
    const profile = await fetchGoogleUserProfile(tokens.access_token);

    if (!profile.email || profile.email_verified === false) {
      return res.status(403).json({
        success: false,
        message: 'Google account email is not verified.'
      });
    }

    const store = readAuthStore();
    const user = upsertGoogleAuthUser(store, profile);
    const token = createAuthSession(store, user);
    writeAuthStore(store);

    return res.json({
      success: true,
      token,
      user: buildPublicAuthUser(user, 'google')
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Google sign-in failed.',
      details: error.details || null
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on ${PREFERRED_LOCAL_ORIGIN}`);
});
