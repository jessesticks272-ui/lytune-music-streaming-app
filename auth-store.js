const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIRECTORY = path.join(__dirname, 'data');
const AUTH_STORE_PATH = path.join(DATA_DIRECTORY, 'auth-store.json');
const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_KEY_LENGTH = 64;
const MIN_PASSWORD_LENGTH = 8;
const MAX_USERNAME_LENGTH = 40;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const createEmptyAuthStore = () => ({
  users: {},
  sessions: {}
});

const ensureDataDirectory = () => {
  if (!fs.existsSync(DATA_DIRECTORY)) {
    fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  }
};

const writeAuthStore = (store) => {
  ensureDataDirectory();
  fs.writeFileSync(AUTH_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
};

const ensureAuthStoreFile = () => {
  ensureDataDirectory();

  if (!fs.existsSync(AUTH_STORE_PATH)) {
    writeAuthStore(createEmptyAuthStore());
  }
};

const readAuthStore = () => {
  ensureAuthStoreFile();

  try {
    const rawValue = fs.readFileSync(AUTH_STORE_PATH, 'utf8');
    const parsedValue = JSON.parse(rawValue);

    if (
      !parsedValue ||
      typeof parsedValue !== 'object' ||
      !parsedValue.users ||
      !parsedValue.sessions
    ) {
      throw new Error('Invalid auth store shape.');
    }

    return parsedValue;
  } catch (error) {
    const fallbackStore = createEmptyAuthStore();
    writeAuthStore(fallbackStore);
    return fallbackStore;
  }
};

const normalizeAuthEmail = (value = '') => value.toString().trim().toLowerCase();
const isValidAuthEmail = (value = '') => EMAIL_PATTERN.test(normalizeAuthEmail(value));

const sanitizeAuthUsername = (value = '') =>
  value
    .toString()
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_USERNAME_LENGTH);

const deriveFallbackUsername = (email = '') => {
  const localPart = normalizeAuthEmail(email).split('@')[0] || 'listener';
  return sanitizeAuthUsername(localPart) || 'listener';
};

const isValidAuthPassword = (value = '') =>
  typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH;

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({
  salt,
  hash: crypto.scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString('hex')
});

const verifyLocalPassword = (user, password = '') => {
  if (!user?.passwordHash || !user?.passwordSalt || typeof password !== 'string') {
    return false;
  }

  const derivedHash = crypto.scryptSync(password, user.passwordSalt, PASSWORD_KEY_LENGTH);
  const storedHash = Buffer.from(user.passwordHash, 'hex');

  if (storedHash.length !== derivedHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedHash, storedHash);
};

const createBaseUser = ({ email, username, avatar = null, googleId = null, providers = [] }) => {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    email,
    username,
    avatar,
    googleId,
    providers: Array.from(new Set(providers)),
    passwordHash: null,
    passwordSalt: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    favoriteArtists: [],
    onboardingCompleted: false,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null
  };
};

const createLocalAuthUser = ({ email, password, username }) => {
  const normalizedEmail = normalizeAuthEmail(email);
  const safeUsername = sanitizeAuthUsername(username) || deriveFallbackUsername(normalizedEmail);
  const { salt, hash } = hashPassword(password);
  const user = createBaseUser({
    email: normalizedEmail,
    username: safeUsername,
    providers: ['local']
  });

  user.passwordSalt = salt;
  user.passwordHash = hash;
  return user;
};

const ensureProvider = (user, provider) => {
  if (!Array.isArray(user.providers)) {
    user.providers = [];
  }

  if (!user.providers.includes(provider)) {
    user.providers.push(provider);
  }
};

const normalizeFavoriteArtists = (value) => {
  if (!Array.isArray(value)) {
    return null;
  }

  const uniqueItems = [];

  value.forEach((item) => {
    const normalizedItem = item
      .toString()
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 60);

    if (
      normalizedItem &&
      !uniqueItems.some((entry) => entry.toLowerCase() === normalizedItem.toLowerCase())
    ) {
      uniqueItems.push(normalizedItem);
    }
  });

  return uniqueItems.slice(0, 5);
};

const updateOnboardingStatus = (user) => {
  user.onboardingCompleted = Boolean(
    user.username &&
      user.birthMonth &&
      Number.isInteger(user.birthDay) &&
      Number.isInteger(user.birthYear) &&
      Array.isArray(user.favoriteArtists) &&
      user.favoriteArtists.length > 0
  );
};

const upsertGoogleAuthUser = (store, profile) => {
  const email = normalizeAuthEmail(profile?.email);
  const fallbackName =
    sanitizeAuthUsername(profile?.name || profile?.given_name || deriveFallbackUsername(email)) ||
    deriveFallbackUsername(email);
  let user = store.users[email];

  if (!user) {
    user = createBaseUser({
      email,
      username: fallbackName,
      avatar: profile?.picture || null,
      googleId: profile?.sub || null,
      providers: ['google']
    });
    store.users[email] = user;
  }

  ensureProvider(user, 'google');

  if (!user.username) {
    user.username = fallbackName;
  }

  if (profile?.picture) {
    user.avatar = profile.picture;
  }

  if (profile?.sub) {
    user.googleId = profile.sub;
  }

  user.updatedAt = new Date().toISOString();
  updateOnboardingStatus(user);
  return user;
};

const buildPublicAuthUser = (user, activeProvider = null) => {
  const username = sanitizeAuthUsername(user?.username) || deriveFallbackUsername(user?.email);

  return {
    id: user?.id || null,
    email: user?.email || null,
    name: username,
    username,
    avatar: user?.avatar || null,
    provider: activeProvider || user?.providers?.[0] || null,
    providers: Array.isArray(user?.providers) ? user.providers : [],
    onboardingCompleted: Boolean(user?.onboardingCompleted),
    favoriteArtists: Array.isArray(user?.favoriteArtists) ? user.favoriteArtists : [],
    birthMonth: user?.birthMonth || null,
    birthDay: Number.isInteger(user?.birthDay) ? user.birthDay : null,
    birthYear: Number.isInteger(user?.birthYear) ? user.birthYear : null
  };
};

const hashSessionToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const pruneExpiredAuthSessions = (store) => {
  let changed = false;
  const now = Date.now();

  Object.entries(store.sessions || {}).forEach(([key, session]) => {
    const expiresAt = Date.parse(session?.expiresAt || '');

    if (!session || Number.isNaN(expiresAt) || expiresAt <= now) {
      delete store.sessions[key];
      changed = true;
    }
  });

  return changed;
};

const createAuthSession = (store, user) => {
  const now = new Date();
  const token = crypto.randomBytes(32).toString('hex');
  const sessionKey = hashSessionToken(token);

  store.sessions[sessionKey] = {
    userId: user.id,
    email: user.email,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + AUTH_SESSION_TTL_MS).toISOString()
  };

  user.lastLoginAt = now.toISOString();
  user.updatedAt = now.toISOString();

  return token;
};

const resolveAuthSession = (token) => {
  if (!token) {
    return {
      store: null,
      user: null,
      sessionKey: null
    };
  }

  const store = readAuthStore();
  let changed = pruneExpiredAuthSessions(store);
  const sessionKey = hashSessionToken(token);
  const session = store.sessions[sessionKey];

  if (!session) {
    if (changed) {
      writeAuthStore(store);
    }

    return {
      store,
      user: null,
      sessionKey: null
    };
  }

  const user = store.users[normalizeAuthEmail(session.email)];

  if (!user) {
    delete store.sessions[sessionKey];
    changed = true;
  }

  if (changed) {
    writeAuthStore(store);
  }

  return {
    store,
    user: user || null,
    sessionKey: user ? sessionKey : null
  };
};

const clearAuthSession = (store, sessionKey) => {
  if (!store?.sessions?.[sessionKey]) {
    return false;
  }

  delete store.sessions[sessionKey];
  return true;
};

const updateAuthUserProfile = (user, payload = {}) => {
  let changed = false;

  if (Object.prototype.hasOwnProperty.call(payload, 'username')) {
    const nextUsername = sanitizeAuthUsername(payload.username);

    if (!nextUsername) {
      throw new Error('Username cannot be empty.');
    }

    if (user.username !== nextUsername) {
      user.username = nextUsername;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'birthMonth')) {
    const birthMonth =
      payload.birthMonth == null ? null : payload.birthMonth.toString().trim().toUpperCase().slice(0, 20);

    if (!birthMonth) {
      throw new Error('Birth month cannot be empty.');
    }

    if (user.birthMonth !== birthMonth) {
      user.birthMonth = birthMonth;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'birthDay')) {
    const birthDay = Number(payload.birthDay);

    if (!Number.isInteger(birthDay) || birthDay < 1 || birthDay > 31) {
      throw new Error('Birth day must be between 1 and 31.');
    }

    if (user.birthDay !== birthDay) {
      user.birthDay = birthDay;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'birthYear')) {
    const currentYear = new Date().getFullYear();
    const birthYear = Number(payload.birthYear);

    if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > currentYear) {
      throw new Error(`Birth year must be between 1900 and ${currentYear}.`);
    }

    if (user.birthYear !== birthYear) {
      user.birthYear = birthYear;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'favoriteArtists')) {
    const favoriteArtists = normalizeFavoriteArtists(payload.favoriteArtists);

    if (favoriteArtists === null) {
      throw new Error('Favorite artists must be an array.');
    }

    const currentArtists = JSON.stringify(user.favoriteArtists || []);
    const nextArtists = JSON.stringify(favoriteArtists);

    if (currentArtists !== nextArtists) {
      user.favoriteArtists = favoriteArtists;
      changed = true;
    }
  }

  const previousStatus = Boolean(user.onboardingCompleted);
  updateOnboardingStatus(user);

  if (user.onboardingCompleted !== previousStatus) {
    changed = true;
  }

  if (changed) {
    user.updatedAt = new Date().toISOString();
  }

  return changed;
};

module.exports = {
  MIN_PASSWORD_LENGTH,
  buildPublicAuthUser,
  clearAuthSession,
  createAuthSession,
  createLocalAuthUser,
  deriveFallbackUsername,
  isValidAuthEmail,
  isValidAuthPassword,
  normalizeAuthEmail,
  readAuthStore,
  resolveAuthSession,
  updateAuthUserProfile,
  upsertGoogleAuthUser,
  verifyLocalPassword,
  writeAuthStore
};
