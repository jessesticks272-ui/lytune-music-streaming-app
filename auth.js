(() => {
  const STORAGE_KEYS = {
    token: 'authToken',
    userEmail: 'userEmail',
    signupEmail: 'signupEmail',
    username: 'username',
    avatar: 'avatar',
    birthMonth: 'birthMonth',
    birthDay: 'birthDay',
    birthYear: 'birthYear',
    artists: 'lytune_artists',
    provider: 'lytuneAuthProvider',
    user: 'lytuneAuthUser',
    onboardingCompleted: 'lytuneOnboardingCompleted'
  };
  const GOOGLE_STATE_KEY = 'lytuneGoogleState';
  const GOOGLE_REDIRECT_KEY = 'lytuneGoogleRedirect';
  const PROFILE_PHOTO_PROMPT_KEY = 'lytuneProfilePhotoPromptPending';
  const AUTH_STYLE_ID = 'lytune-auth-style';
  const ENTRY_PAGE_NAMES = new Set(['', 'index.html', 'login.html', 'signup.html']);
  const DEFAULT_AVATAR_SRC = 'assets/images/profile.png';
  const MAX_PROFILE_IMAGE_FILE_SIZE_BYTES = 2 * 1024 * 1024;
  let googleConfigPromise = null;

  const getUniqueItems = (items) => Array.from(new Set(items.filter(Boolean)));
  const isPreferredAppOrigin = (value = '') => {
    try {
      const parsed = new URL(value);
      return (
        ['lytune.localhost', 'localhost', '127.0.0.1'].includes(parsed.hostname) &&
        parsed.port === '3000'
      );
    } catch (error) {
      return false;
    }
  };

  const getApiBaseCandidates = () => {
    const origin = window.location?.origin;
    const normalizedOrigin =
      origin && origin !== 'null' ? origin.replace(/\/$/, '') : null;
    const preferredOrigins = ['http://lytune.localhost:3000', 'http://localhost:3000'];

    if (normalizedOrigin) {
      if (isPreferredAppOrigin(normalizedOrigin)) {
        return getUniqueItems([normalizedOrigin, ...preferredOrigins]);
      }

      return getUniqueItems([normalizedOrigin, ...preferredOrigins]);
    }

    return getUniqueItems(preferredOrigins);
  };

  const getCurrentPageName = () => {
    const path = (window.location.pathname || '/').split('/').filter(Boolean).pop();
    return path || '';
  };

  const parseResponsePayload = async (response) => {
    const rawValue = await response.text();

    if (!rawValue) {
      return {};
    }

    try {
      return JSON.parse(rawValue);
    } catch (error) {
      return {
        success: response.ok,
        message: rawValue
      };
    }
  };

  const shouldTryNextApiBase = (error, candidateIndex, totalCandidates) => {
    if (candidateIndex >= totalCandidates - 1) {
      return false;
    }

    if (!error?.isHttpError) {
      return true;
    }

    return [404, 405, 501].includes(Number(error.status));
  };

  const createServerUnavailableError = () =>
    new Error(
      'We could not reach the Lytune server. Start node server.js and open Lytune on http://lytune.localhost:3000/.'
    );

  const requestAuthApi = async (endpoint, options = {}) => {
    const candidates = getApiBaseCandidates();
    let lastError = createServerUnavailableError();

    for (const [candidateIndex, baseUrl] of candidates.entries()) {
      try {
        const response = await fetch(`${baseUrl}${endpoint}`, {
          ...options,
          headers: {
            Accept: 'application/json',
            ...(options.headers || {})
          }
        });
        const payload = await parseResponsePayload(response);

        if (!response.ok) {
          const httpError = new Error(payload.message || `Request failed with status ${response.status}.`);
          httpError.status = response.status;
          httpError.payload = payload;
          httpError.isHttpError = true;
          throw httpError;
        }

        return payload;
      } catch (error) {
        lastError = error;

        if (
          error?.isHttpError &&
          [404, 405, 501].includes(Number(error.status)) &&
          !isPreferredAppOrigin(baseUrl)
        ) {
          lastError = createServerUnavailableError();
        }

        if (!shouldTryNextApiBase(error, candidateIndex, candidates.length)) {
          break;
        }
      }
    }

    throw lastError;
  };

  const ensureAuthStyles = () => {
    if (document.getElementById(AUTH_STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = AUTH_STYLE_ID;
    style.textContent = `
      .lytune-auth-message {
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: 14px;
        font-size: 0.95rem;
        line-height: 1.45;
        display: none;
        border: 1px solid transparent;
        backdrop-filter: blur(8px);
      }

      .lytune-auth-message[data-tone="error"] {
        display: block;
        background: rgba(122, 28, 28, 0.42);
        border-color: rgba(255, 156, 156, 0.35);
        color: #fff1f1;
      }

      .lytune-auth-message[data-tone="success"] {
        display: block;
        background: rgba(19, 112, 75, 0.35);
        border-color: rgba(146, 255, 212, 0.32);
        color: #effff7;
      }

      .lytune-auth-message[data-tone="neutral"] {
        display: block;
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(255, 255, 255, 0.18);
        color: #ffffff;
      }

      .lytune-auth-loader {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(5, 8, 18, 0.55);
      }

      .lytune-auth-loader.is-visible {
        display: flex;
      }

      .lytune-auth-loader__card {
        min-width: 180px;
        padding: 18px 22px;
        border-radius: 18px;
        text-align: center;
        color: #ffffff;
        background: rgba(14, 18, 34, 0.86);
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
      }

      .lytune-auth-loader__spinner {
        width: 28px;
        height: 28px;
        margin: 0 auto 12px;
        border: 3px solid rgba(255, 255, 255, 0.2);
        border-top-color: #ffffff;
        border-radius: 50%;
        animation: lytune-auth-spin 0.8s linear infinite;
      }

      .google-btn[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
      }

      .lytune-profile-prompt {
        position: fixed;
        inset: 0;
        z-index: 9998;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(6, 10, 20, 0.76);
      }

      .lytune-profile-prompt.is-visible {
        display: flex;
      }

      .lytune-profile-prompt__card {
        width: min(460px, 100%);
        padding: 28px;
        border-radius: 28px;
        background: linear-gradient(180deg, rgba(20, 28, 54, 0.96), rgba(8, 12, 24, 0.96));
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 25px 80px rgba(0, 0, 0, 0.35);
        color: #ffffff;
        text-align: center;
      }

      .lytune-profile-prompt__avatar {
        width: 92px;
        height: 92px;
        margin: 0 auto 18px;
        border-radius: 50%;
        object-fit: cover;
        border: 3px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.08);
      }

      .lytune-profile-prompt__eyebrow {
        margin: 0 0 8px;
        font-size: 0.8rem;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.7);
      }

      .lytune-profile-prompt__title {
        margin: 0 0 10px;
        font-size: 1.75rem;
        line-height: 1.1;
      }

      .lytune-profile-prompt__copy {
        margin: 0;
        color: rgba(255, 255, 255, 0.8);
        line-height: 1.6;
      }

      .lytune-profile-prompt__hint {
        margin: 14px 0 0;
        color: rgba(255, 255, 255, 0.62);
        font-size: 0.92rem;
        line-height: 1.55;
      }

      .lytune-profile-prompt__status {
        min-height: 24px;
        margin: 16px 0 0;
        font-size: 0.95rem;
        color: #ffd6d6;
      }

      .lytune-profile-prompt__actions {
        display: flex;
        gap: 12px;
        justify-content: center;
        margin-top: 22px;
        flex-wrap: wrap;
      }

      .lytune-profile-prompt__button {
        border: none;
        border-radius: 999px;
        padding: 12px 18px;
        font: inherit;
        cursor: pointer;
        transition: transform 0.2s ease, opacity 0.2s ease;
      }

      .lytune-profile-prompt__button:hover {
        transform: translateY(-1px);
      }

      .lytune-profile-prompt__button--primary {
        background: #ffffff;
        color: #091224;
        font-weight: 700;
      }

      .lytune-profile-prompt__button--ghost {
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.14);
      }

      .lytune-profile-prompt__button[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
        transform: none;
      }

      @keyframes lytune-auth-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `;

    document.head.appendChild(style);
  };

  const getAuthSurface = () =>
    document.querySelector('.login-card') ||
    document.querySelector('.container') ||
    document.body;

  const ensureMessageElement = () => {
    ensureAuthStyles();
    let messageElement = document.querySelector('[data-lytune-auth-message]');

    if (!messageElement) {
      messageElement = document.createElement('div');
      messageElement.className = 'lytune-auth-message';
      messageElement.setAttribute('data-lytune-auth-message', 'true');
      getAuthSurface().appendChild(messageElement);
    }

    return messageElement;
  };

  const ensureLoaderElement = () => {
    ensureAuthStyles();
    let loaderElement = document.querySelector('[data-lytune-auth-loader]');

    if (!loaderElement) {
      loaderElement = document.createElement('div');
      loaderElement.className = 'lytune-auth-loader';
      loaderElement.setAttribute('data-lytune-auth-loader', 'true');
      loaderElement.innerHTML = `
        <div class="lytune-auth-loader__card" role="status" aria-live="polite">
          <div class="lytune-auth-loader__spinner"></div>
          <div data-lytune-auth-loader-text>Working...</div>
        </div>
      `;
      document.body.appendChild(loaderElement);
    }

    return loaderElement;
  };

  const setMessage = (message = '', tone = 'neutral') => {
    const messageElement = ensureMessageElement();

    if (!message) {
      messageElement.textContent = '';
      messageElement.style.display = 'none';
      messageElement.removeAttribute('data-tone');
      return;
    }

    messageElement.textContent = message;
    messageElement.style.display = 'block';
    messageElement.setAttribute('data-tone', tone);
  };

  const showLoader = (label = 'Please wait...') => {
    const loaderElement = ensureLoaderElement();
    const textElement = loaderElement.querySelector('[data-lytune-auth-loader-text]');

    if (textElement) {
      textElement.textContent = label;
    }

    loaderElement.classList.add('is-visible');
  };

  const hideLoader = () => {
    const loaderElement = document.querySelector('[data-lytune-auth-loader]');

    if (loaderElement) {
      loaderElement.classList.remove('is-visible');
    }
  };

  const getResolvedAvatarSrc = (avatarValue = null) => {
    if (typeof avatarValue === 'string' && avatarValue.trim()) {
      return avatarValue.trim();
    }

    return DEFAULT_AVATAR_SRC;
  };

  const syncAvatarTargets = (avatarValue = null) => {
    const resolvedAvatar = getResolvedAvatarSrc(avatarValue);

    document.querySelectorAll('#avatar, #settings-avatar, [data-lytune-avatar]').forEach((image) => {
      image.src = resolvedAvatar;
    });

    const promptAvatar = document.querySelector('[data-lytune-profile-prompt-avatar]');

    if (promptAvatar) {
      promptAvatar.src = resolvedAvatar;
    }
  };

  const hasStoredAvatar = () => {
    const avatarValue = localStorage.getItem(STORAGE_KEYS.avatar);
    return Boolean(avatarValue && avatarValue.trim());
  };

  const clearProfilePhotoPromptFlag = () => {
    localStorage.removeItem(PROFILE_PHOTO_PROMPT_KEY);
  };

  const queueProfilePhotoPrompt = (user = null) => {
    const avatarValue = user?.avatar || localStorage.getItem(STORAGE_KEYS.avatar);

    if (avatarValue) {
      clearProfilePhotoPromptFlag();
      return;
    }

    localStorage.setItem(PROFILE_PHOTO_PROMPT_KEY, 'true');
  };

  const ensureProfilePhotoPrompt = () => {
    ensureAuthStyles();
    let promptElement = document.querySelector('[data-lytune-profile-prompt]');

    if (!promptElement) {
      promptElement = document.createElement('div');
      promptElement.className = 'lytune-profile-prompt';
      promptElement.setAttribute('data-lytune-profile-prompt', 'true');
      promptElement.innerHTML = `
        <div class="lytune-profile-prompt__card" role="dialog" aria-modal="true" aria-labelledby="lytune-profile-prompt-title">
          <img
            class="lytune-profile-prompt__avatar"
            src="${DEFAULT_AVATAR_SRC}"
            alt="Default profile"
            data-lytune-profile-prompt-avatar
          >
          <p class="lytune-profile-prompt__eyebrow">Unknown profile</p>
          <h2 class="lytune-profile-prompt__title" id="lytune-profile-prompt-title">Add a profile picture?</h2>
          <p class="lytune-profile-prompt__copy">
            Your account is using the default unknown profile image right now. You can keep it, or choose a picture for your profile.
          </p>
          <p class="lytune-profile-prompt__hint">
            Pick any image from Downloads, Pictures, or another folder on your device. The browser can only use files you select yourself.
          </p>
          <p class="lytune-profile-prompt__status" data-lytune-profile-prompt-status></p>
          <div class="lytune-profile-prompt__actions">
            <button type="button" class="lytune-profile-prompt__button lytune-profile-prompt__button--primary" data-lytune-profile-prompt-choose>
              Choose photo
            </button>
            <button type="button" class="lytune-profile-prompt__button lytune-profile-prompt__button--ghost" data-lytune-profile-prompt-later>
              Maybe later
            </button>
          </div>
          <input type="file" accept="image/*" hidden data-lytune-profile-prompt-input>
        </div>
      `;
      document.body.appendChild(promptElement);

      const chooseButton = promptElement.querySelector('[data-lytune-profile-prompt-choose]');
      const laterButton = promptElement.querySelector('[data-lytune-profile-prompt-later]');
      const fileInput = promptElement.querySelector('[data-lytune-profile-prompt-input]');

      chooseButton.addEventListener('click', () => {
        fileInput.click();
      });

      laterButton.addEventListener('click', () => {
        clearProfilePhotoPromptFlag();
        promptElement.classList.remove('is-visible');
      });
    }

    return promptElement;
  };

  const setProfilePhotoPromptStatus = (message = '') => {
    const promptElement = ensureProfilePhotoPrompt();
    const statusElement = promptElement.querySelector('[data-lytune-profile-prompt-status]');

    if (statusElement) {
      statusElement.textContent = message;
    }
  };

  const showProfilePhotoPrompt = () => {
    const promptElement = ensureProfilePhotoPrompt();
    syncAvatarTargets(localStorage.getItem(STORAGE_KEYS.avatar));
    setProfilePhotoPromptStatus('');
    promptElement.classList.add('is-visible');
  };

  const hideProfilePhotoPrompt = () => {
    const promptElement = document.querySelector('[data-lytune-profile-prompt]');

    if (promptElement) {
      promptElement.classList.remove('is-visible');
    }
  };

  const shouldShowProfilePhotoPrompt = () =>
    localStorage.getItem(PROFILE_PHOTO_PROMPT_KEY) === 'true' &&
    !ENTRY_PAGE_NAMES.has(getCurrentPageName()) &&
    !hasStoredAvatar();

  const readFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => reject(new Error('We could not read that image.'));
      reader.onload = () => {
        if (typeof reader.result !== 'string' || !reader.result) {
          reject(new Error('We could not read that image.'));
          return;
        }

        resolve(reader.result);
      };

      reader.readAsDataURL(file);
    });

  const setStoredValue = (key, value) => {
    if (value == null || value === '') {
      localStorage.removeItem(key);
      return;
    }

    localStorage.setItem(key, String(value));
  };

  const persistAuthState = (user, token = null) => {
    if (token) {
      localStorage.setItem(STORAGE_KEYS.token, token);
    }

    if (!user || typeof user !== 'object') {
      return;
    }

    const username = user.username || user.name || '';

    setStoredValue(STORAGE_KEYS.userEmail, user.email || null);
    setStoredValue(STORAGE_KEYS.signupEmail, user.email || null);
    setStoredValue(STORAGE_KEYS.username, username || null);
    setStoredValue(STORAGE_KEYS.provider, user.provider || null);
    setStoredValue(STORAGE_KEYS.birthMonth, user.birthMonth || null);
    setStoredValue(
      STORAGE_KEYS.birthDay,
      Number.isInteger(user.birthDay) ? user.birthDay : null
    );
    setStoredValue(
      STORAGE_KEYS.birthYear,
      Number.isInteger(user.birthYear) ? user.birthYear : null
    );

    if (Array.isArray(user.favoriteArtists)) {
      localStorage.setItem(STORAGE_KEYS.artists, JSON.stringify(user.favoriteArtists));
    }

    if ('avatar' in user) {
      setStoredValue(STORAGE_KEYS.avatar, user.avatar || null);
    }

    localStorage.setItem(
      STORAGE_KEYS.onboardingCompleted,
      user.onboardingCompleted ? 'true' : 'false'
    );
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
    syncAvatarTargets(user.avatar || null);
  };

  const clearAuthState = () => {
    Object.values(STORAGE_KEYS).forEach((key) => {
      localStorage.removeItem(key);
    });

    localStorage.removeItem(GOOGLE_STATE_KEY);
    localStorage.removeItem(GOOGLE_REDIRECT_KEY);
    localStorage.removeItem(PROFILE_PHOTO_PROMPT_KEY);
    syncAvatarTargets(null);
  };

  const createAuthHeaders = (includeJson = false) => {
    const headers = {};
    const token = localStorage.getItem(STORAGE_KEYS.token);

    if (includeJson) {
      headers['Content-Type'] = 'application/json';
    }

    if (token) {
      headers['X-Lytune-Auth-Token'] = token;
    }

    return headers;
  };

  const getNextOnboardingPath = (user) => {
    const hasBirthDate =
      Boolean(user?.birthMonth) &&
      Number.isInteger(user?.birthDay) &&
      Number.isInteger(user?.birthYear);
    const hasArtists = Array.isArray(user?.favoriteArtists) && user.favoriteArtists.length > 0;

    if (!hasBirthDate) {
      return 'dob.html';
    }

    if (!hasArtists) {
      return 'choose-artist.html';
    }

    return null;
  };

  const resolveRedirectTarget = (user, preferredRedirect) => {
    return getNextOnboardingPath(user) || preferredRedirect || 'home.html';
  };

  const updateProfile = async (payload) => {
    const token = localStorage.getItem(STORAGE_KEYS.token);

    if (!token) {
      throw new Error('Please sign in before updating your profile.');
    }

    try {
      const response = await requestAuthApi('/api/auth/profile', {
        method: 'PATCH',
        headers: createAuthHeaders(true),
        body: JSON.stringify(payload || {})
      });

      if (response?.user) {
        persistAuthState(response.user, token);
      }

      return response;
    } catch (error) {
      if (error.status === 401) {
        clearAuthState();
      }

      throw error;
    }
  };

  const saveProfilePhotoDataUrl = async (avatarDataUrl, options = {}) => {
    if (!avatarDataUrl) {
      throw new Error('Choose an image before saving your profile picture.');
    }

    const token = localStorage.getItem(STORAGE_KEYS.token);

    if (!token) {
      setStoredValue(STORAGE_KEYS.avatar, avatarDataUrl);
      syncAvatarTargets(avatarDataUrl);
      clearProfilePhotoPromptFlag();
      hideProfilePhotoPrompt();
      return avatarDataUrl;
    }

    const response = await updateProfile({
      avatar: avatarDataUrl
    });

    if (!options.silentSuccess) {
      setMessage('Profile picture updated.', 'success');
    }

    clearProfilePhotoPromptFlag();
    hideProfilePhotoPrompt();
    return response?.user?.avatar || avatarDataUrl;
  };

  const handleProfileUpload = async (file, options = {}) => {
    if (!file) {
      return null;
    }

    if (!file.type || !file.type.startsWith('image/')) {
      throw new Error('Choose a valid image file.');
    }

    if (file.size > MAX_PROFILE_IMAGE_FILE_SIZE_BYTES) {
      throw new Error('Profile photo is too large. Choose an image under 2 MB.');
    }

    setProfilePhotoPromptStatus('');
    showLoader('Saving your profile picture...');
    const previousAvatar = localStorage.getItem(STORAGE_KEYS.avatar);

    try {
      const avatarDataUrl = await readFileAsDataUrl(file);
      syncAvatarTargets(avatarDataUrl);
      setStoredValue(STORAGE_KEYS.avatar, avatarDataUrl);
      return await saveProfilePhotoDataUrl(avatarDataUrl, options);
    } catch (error) {
      setStoredValue(STORAGE_KEYS.avatar, previousAvatar);
      syncAvatarTargets(previousAvatar);
      setProfilePhotoPromptStatus(error.message || 'We could not save your profile picture.');
      throw error;
    } finally {
      hideLoader();
    }
  };

  const fetchCurrentUser = async () => {
    const token = localStorage.getItem(STORAGE_KEYS.token);

    if (!token) {
      return null;
    }

    try {
      const response = await requestAuthApi('/api/auth/me', {
        method: 'GET',
        headers: createAuthHeaders(false)
      });

      if (response?.user) {
        persistAuthState(response.user, token);
        return response.user;
      }
    } catch (error) {
      if (error.status === 401) {
        clearAuthState();
        return null;
      }

      throw error;
    }

    return null;
  };

  const logout = async () => {
    const token = localStorage.getItem(STORAGE_KEYS.token);

    if (!token) {
      clearAuthState();
      return;
    }

    try {
      await requestAuthApi('/api/auth/logout', {
        method: 'POST',
        headers: createAuthHeaders(false)
      });
    } finally {
      clearAuthState();
    }
  };

  const bindSharedProfilePhotoInputs = () => {
    document.querySelectorAll('#avatar-upload').forEach((input) => {
      if (input.dataset.lytuneAvatarBound === 'true') {
        return;
      }

      input.dataset.lytuneAvatarBound = 'true';
      input.addEventListener('change', async function handleAvatarChange() {
        const file = this.files?.[0];

        if (!file) {
          return;
        }

        try {
          await handleProfileUpload(file, {
            silentSuccess: true
          });
        } catch (error) {
          setMessage(error.message || 'We could not save your profile picture.', 'error');
        } finally {
          this.value = '';
        }
      });
    });

    const promptElement = ensureProfilePhotoPrompt();
    const promptInput = promptElement.querySelector('[data-lytune-profile-prompt-input]');

    if (promptInput && promptInput.dataset.lytuneAvatarBound !== 'true') {
      promptInput.dataset.lytuneAvatarBound = 'true';
      promptInput.addEventListener('change', async function handlePromptAvatarChange() {
        const file = this.files?.[0];

        if (!file) {
          return;
        }

        try {
          await handleProfileUpload(file, {
            silentSuccess: true
          });
        } catch (error) {
          setMessage(error.message || 'We could not save your profile picture.', 'error');
        } finally {
          this.value = '';
        }
      });
    }
  };

  const setFormBusy = (form, busy) => {
    const elements = form.querySelectorAll('input, button');
    elements.forEach((element) => {
      element.disabled = busy;
    });

    form.setAttribute('aria-busy', busy ? 'true' : 'false');
  };

  const handleAuthFormSubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const mode = form.getAttribute('data-auth-form');
    const redirectTarget =
      form.getAttribute('data-auth-redirect') ||
      form.getAttribute('action') ||
      'home.html';
    const emailInput = form.querySelector('input[type="email"]');
    const passwordInput = form.querySelector('input[type="password"]');
    const usernameInput = form.querySelector('input[name="username"], [data-auth-username]');
    const email = emailInput?.value.trim() || '';
    const password = passwordInput?.value || '';
    const payload = {
      email,
      password
    };

    if (usernameInput?.value.trim()) {
      payload.username = usernameInput.value.trim();
    }

    setMessage('', 'neutral');
    showLoader(mode === 'signup' ? 'Creating your account...' : 'Signing you in...');
    setFormBusy(form, true);

    try {
      const response = await requestAuthApi(`/api/auth/${mode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      persistAuthState(response.user, response.token);
      queueProfilePhotoPrompt(response.user);
      setMessage(response.message || 'Success.', 'success');

      window.location.href = resolveRedirectTarget(response.user, redirectTarget);
    } catch (error) {
      hideLoader();
      setFormBusy(form, false);
      setMessage(error.message || 'Something went wrong. Please try again.', 'error');
    }
  };

  const bindAuthForms = () => {
    document.querySelectorAll('[data-auth-form]').forEach((form) => {
      if (form.dataset.authBound === 'true') {
        return;
      }

      form.dataset.authBound = 'true';
      form.addEventListener('submit', handleAuthFormSubmit);
    });
  };

  const createGoogleState = () => {
    if (window.crypto?.getRandomValues) {
      const values = new Uint32Array(4);
      window.crypto.getRandomValues(values);
      return Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('');
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const getGoogleConfig = async () => {
    if (!googleConfigPromise) {
      googleConfigPromise = requestAuthApi('/api/auth/google/config', {
        method: 'GET'
      }).catch((error) => {
        googleConfigPromise = null;
        throw error;
      });
    }

    return googleConfigPromise;
  };

  const startGoogleAuth = async (redirectTarget) => {
    const config = await getGoogleConfig();

    if (!config?.enabled || !config.clientId) {
      throw new Error('Google sign-in is not configured yet.');
    }

    if (!window.location.origin || window.location.origin === 'null') {
      throw new Error('Open Lytune through the local server before using Google sign-in.');
    }

    const state = createGoogleState();
    localStorage.setItem(GOOGLE_STATE_KEY, state);
    localStorage.setItem(GOOGLE_REDIRECT_KEY, redirectTarget || 'home.html');

    const query = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: window.location.origin,
      response_type: 'code',
      scope: 'openid email profile',
      prompt: 'select_account',
      state
    });

    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
  };

  const bindGoogleButtons = async () => {
    const buttons = Array.from(document.querySelectorAll('[data-google-auth]'));

    if (!buttons.length) {
      return;
    }

    let config = null;

    try {
      config = await getGoogleConfig();
    } catch (error) {
      buttons.forEach((button) => {
        button.disabled = true;
        button.title = 'Google sign-in is unavailable right now.';
      });
      return;
    }

    buttons.forEach((button) => {
      if (!config?.enabled || !config.clientId) {
        button.disabled = true;
        button.title = 'Google sign-in is not configured yet.';
        return;
      }

      button.addEventListener('click', async () => {
        const redirectTarget = button.getAttribute('data-auth-redirect') || 'home.html';

        setMessage('', 'neutral');
        showLoader('Redirecting to Google...');

        try {
          await startGoogleAuth(redirectTarget);
        } catch (error) {
          hideLoader();
          setMessage(error.message || 'Google sign-in failed to start.', 'error');
        }
      });
    });
  };

  const finishGoogleAuthIfNeeded = async () => {
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (!code && !error) {
      return false;
    }

    const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;

    if (error) {
      window.history.replaceState({}, document.title, cleanUrl);
      localStorage.removeItem(GOOGLE_STATE_KEY);
      localStorage.removeItem(GOOGLE_REDIRECT_KEY);
      setMessage('Google sign-in was cancelled.', 'error');
      return true;
    }

    const expectedState = localStorage.getItem(GOOGLE_STATE_KEY);
    const redirectTarget = localStorage.getItem(GOOGLE_REDIRECT_KEY) || 'home.html';

    if (!state || !expectedState || state !== expectedState) {
      window.history.replaceState({}, document.title, cleanUrl);
      localStorage.removeItem(GOOGLE_STATE_KEY);
      localStorage.removeItem(GOOGLE_REDIRECT_KEY);
      setMessage('Google sign-in could not be verified. Please try again.', 'error');
      return true;
    }

    showLoader('Completing Google sign-in...');

    try {
      const response = await requestAuthApi('/api/auth/google', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code,
          redirectUri: window.location.origin
        })
      });

      persistAuthState(response.user, response.token);
      queueProfilePhotoPrompt(response.user);
      window.history.replaceState({}, document.title, cleanUrl);
      localStorage.removeItem(GOOGLE_STATE_KEY);
      localStorage.removeItem(GOOGLE_REDIRECT_KEY);
      window.location.href = resolveRedirectTarget(response.user, redirectTarget);
      return true;
    } catch (exchangeError) {
      hideLoader();
      window.history.replaceState({}, document.title, cleanUrl);
      localStorage.removeItem(GOOGLE_STATE_KEY);
      localStorage.removeItem(GOOGLE_REDIRECT_KEY);
      setMessage(exchangeError.message || 'Google sign-in failed.', 'error');
      return true;
    }
  };

  const syncExistingSession = async () => {
    if (!localStorage.getItem(STORAGE_KEYS.token)) {
      syncAvatarTargets(localStorage.getItem(STORAGE_KEYS.avatar));
      return;
    }

    try {
      const user = await fetchCurrentUser();
      const currentPageName = getCurrentPageName();

      if (
        user &&
        ENTRY_PAGE_NAMES.has(currentPageName) &&
        document.querySelector('[data-auth-form]')
      ) {
        setMessage(
          `You are already signed in as ${user.username || user.name || user.email}.`,
          'neutral'
        );
      }

      if (shouldShowProfilePhotoPrompt()) {
        showProfilePhotoPrompt();
      }
    } catch (error) {
      setMessage(error.message || 'We could not restore your session.', 'error');
    }
  };

  const initialize = async () => {
    ensureAuthStyles();
    bindAuthForms();
    bindSharedProfilePhotoInputs();
    await bindGoogleButtons();

    const handledGoogleCallback = await finishGoogleAuthIfNeeded();

    if (!handledGoogleCallback) {
      await syncExistingSession();
    } else if (shouldShowProfilePhotoPrompt()) {
      showProfilePhotoPrompt();
    }
  };

  window.LytuneAuth = {
    clearAuthState,
    fetchCurrentUser,
    handleProfileUpload,
    hideLoader,
    logout,
    saveProfilePhotoDataUrl,
    setMessage,
    showLoader,
    syncAvatarTargets,
    updateProfile
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();
