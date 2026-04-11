(function () {
  const STORAGE_KEY = "lytune-player-state-v1";
  const SPEED_OPTIONS = [0.85, 1, 1.15, 1.3, 1.5];
  const PREFERRED_LOCAL_ORIGIN = "http://lytune.localhost:3000";
  const API_BASE_CANDIDATES = (() => {
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
      return Array.from(new Set(["", PREFERRED_LOCAL_ORIGIN, "http://localhost:3000", "http://127.0.0.1:3000"]));
    }

    return [PREFERRED_LOCAL_ORIGIN, "http://localhost:3000", "http://127.0.0.1:3000", ""];
  })();
  const listeners = new Set();
  let audio = null;
  let shell = null;
  let state = {
    track: null,
    playing: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
    notice: "Pick a song to start listening in Lytune."
  };

  const formatTime = (value) => {
    const safeValue = Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
    const minutes = Math.floor(safeValue / 60);
    const seconds = Math.floor(safeValue % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  const formatRate = (value) => {
    const safeValue = Number(value);

    if (!Number.isFinite(safeValue)) {
      return "1.0x";
    }

    return `${safeValue.toFixed(Number.isInteger(safeValue) ? 1 : 2).replace(/0$/, "")}x`;
  };

  const getToggleIconMarkup = (playing) =>
    playing
      ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 5h4v14H7zm6 0h4v14h-4z"></path></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"></path></svg>';

  const cloneState = () => JSON.parse(JSON.stringify(state));

  const fetchJsonFromCandidates = async (path) => {
    let lastError = null;

    for (const base of API_BASE_CANDIDATES) {
      try {
        const response = await fetch(`${base}${path}`);

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Request failed.");
  };

  const buildContentUrl = (track) => {
    if (!track) {
      return "search.html";
    }

    if (track.contentUrl) {
      return track.contentUrl;
    }

    const query = new URLSearchParams({
      type: track.type || "track",
      id: track.id || ""
    });

    if ((track.type || "track") === "track") { 
      query.set("autoplay", "1");
    }

    return `content.html?${query.toString()}`;
  };

  const getInlineTrackValue = (element, key) => {
    if (!element?.dataset) {
      return "";
    }

    return String(element.dataset[key] || "").trim();
  };

  const getTextFromSelectors = (element, selectors = []) => {
    for (const selector of selectors) {
      const node = element.querySelector(selector);
      const value = node?.textContent?.trim();

      if (value) {
        return value;
      }
    }

    return "";
  };

  const buildRelativeContentUrl = (targetUrl) => {
    if (!targetUrl) {
      return "search.html";
    }

    return `${targetUrl.pathname.split("/").pop() || "content.html"}${targetUrl.search}`;
  };

  const extractTrackMetadataFromLink = (link, targetUrl) => {
    if (!link || !targetUrl) {
      return null;
    }

    const id = getInlineTrackValue(link, "trackId") || targetUrl.searchParams.get("id") || "";

    if (!id) {
      return null;
    }

    const title =
      getInlineTrackValue(link, "trackTitle") ||
      getTextFromSelectors(link, [
        "[data-track-title]",
        ".result-title",
        ".top-result-title",
        ".deezer-title",
        ".card-track-title",
        "strong",
        "p"
      ]) ||
      "Untitled";
    const subtitle =
      getInlineTrackValue(link, "trackSubtitle") ||
      getTextFromSelectors(link, [
        "[data-track-subtitle]",
        ".result-subtitle",
        ".top-result-subtitle",
        ".deezer-artist",
        ".download-copy span:last-of-type",
        ".session-row span",
        ".creator-card span",
        "span"
      ]);
    const image =
      getInlineTrackValue(link, "trackImage") ||
      link.querySelector("img")?.getAttribute("src") ||
      "assets/images/logo.png";
    const previewUrl = getInlineTrackValue(link, "trackPreview") || null;
    const sourceLink = getInlineTrackValue(link, "trackSource") || null;

    return normalizeTrack({
      id,
      type: "track",
      title,
      subtitle,
      image,
      previewUrl,
      link: sourceLink,
      contentUrl: buildRelativeContentUrl(targetUrl)
    });
  };

  const normalizeTrack = (track) => {
    if (!track) {
      return null;
    }

    return {
      id: String(track.id || "").trim(),
      type: track.type || "track",
      title: track.title || "Untitled",
      subtitle: track.subtitle || track.artistName || track.artist?.name || "",
      image: track.image || "assets/images/logo.png",
      previewUrl: track.previewUrl || track.preview || null,
      duration: Number.isFinite(Number(track.duration))
        ? Number(track.duration)
        : Number.isFinite(Number(track.durationSeconds))
          ? Number(track.durationSeconds)
          : 0,
      bpm: Number.isFinite(Number(track.bpm)) ? Math.round(Number(track.bpm)) : null,
      link: track.link || null,
      contentUrl: buildContentUrl(track)
    };
  };

  const persistState = () => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...cloneState(),
          playing: Boolean(audio && !audio.paused),
          currentTime: Number.isFinite(audio?.currentTime) ? audio.currentTime : state.currentTime,
          duration: Number.isFinite(audio?.duration) ? audio.duration : state.duration
        })
      );
    } catch (error) {
      console.error("Could not persist Lytune player state:", error);
    }
  };

  const loadStoredState = () => {
    try {
      const rawValue = localStorage.getItem(STORAGE_KEY);

      if (!rawValue) {
        return;
      }

      const parsedValue = JSON.parse(rawValue);
      state = {
        ...state,
        ...parsedValue,
        track: normalizeTrack(parsedValue.track),
        playing: false,
        currentTime: Number.isFinite(Number(parsedValue.currentTime)) ? Number(parsedValue.currentTime) : 0,
        duration: Number.isFinite(Number(parsedValue.duration)) ? Number(parsedValue.duration) : 0,
        playbackRate: SPEED_OPTIONS.includes(parsedValue.playbackRate)
          ? parsedValue.playbackRate
          : 1,
        notice: parsedValue.track
          ? "Ready to resume this song on this page."
          : state.notice
      };
    } catch (error) {
      console.error("Could not read Lytune player state:", error);
    }
  };

  const updateMediaSession = () => {
    if (!("mediaSession" in navigator)) {
      return;
    }

    if (!state.track) {
      navigator.mediaSession.metadata = null;
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: state.track.title,
      artist: state.track.subtitle || "Lytune",
      album: "Lytune",
      artwork: [
        {
          src: state.track.image,
          sizes: "512x512",
          type: "image/png"
        }
      ]
    });

    navigator.mediaSession.setActionHandler("play", () => {
      playCurrent();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      pause();
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") {
        seek(details.seekTime);
      }
    });
  };

  const render = () => {
    if (!shell) {
      return;
    }

    syncShellOffset();

    const track = state.track;
    shell.classList.toggle("show", Boolean(track));
    shell.classList.toggle("is-playing", Boolean(track && state.playing));

    if (!track) {
      document.body.classList.remove("has-lytune-player");
      return;
    }

    document.body.classList.add("has-lytune-player");

    const art = shell.querySelector("[data-player-art]");
    const kicker = shell.querySelector("[data-player-kicker]");
    const title = shell.querySelector("[data-player-title]");
    const subtitle = shell.querySelector("[data-player-subtitle]");
    const note = shell.querySelector("[data-player-note]");
    const playButton = shell.querySelector("[data-player-toggle]");
    const speedButton = shell.querySelector("[data-player-speed]");
    const openLink = shell.querySelector("[data-player-open]");
    const progress = shell.querySelector("[data-player-progress]");
    const current = shell.querySelector("[data-player-current]");
    const duration = shell.querySelector("[data-player-duration]");

    art.src = track.image;
    art.alt = track.title;
    kicker.textContent = state.playing
      ? "Now playing"
      : track.previewUrl
        ? "Ready to play"
        : "Preview unavailable";
    title.textContent = track.title;
    subtitle.textContent = track.subtitle || "Lytune";
    note.textContent = state.notice || (track.previewUrl ? "Preview is ready." : "Preview unavailable.");
    playButton.innerHTML = getToggleIconMarkup(state.playing);
    playButton.setAttribute("aria-label", state.playing ? "Pause preview" : "Play preview");
    playButton.disabled = !track.previewUrl;
    speedButton.textContent = formatRate(state.playbackRate);
    speedButton.setAttribute("aria-label", `Playback speed ${formatRate(state.playbackRate)}`);
    speedButton.disabled = !track.previewUrl;
    openLink.href = track.contentUrl;
    openLink.textContent = "Details";
    progress.max = String(Math.max(30, Math.round(state.duration || track.duration || 30)));
    progress.value = String(
      Math.min(
        Math.round(state.currentTime || 0),
        Math.max(30, Math.round(state.duration || track.duration || 30))
      )
    );
    progress.disabled = !track.previewUrl;
    current.textContent = formatTime(state.currentTime || 0);
    duration.textContent = formatTime(state.duration || track.duration || 30);
    updateMediaSession();
  };

  const emitChange = () => {
    render();
    persistState();
    const snapshot = cloneState();
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        console.error("Lytune player listener failed:", error);
      }
    });

    window.dispatchEvent(new CustomEvent("lytune:player-state", { detail: snapshot }));
  };

  const syncFromAudio = () => {
    if (!audio) {
      state.playing = false;
      emitChange();
      return;
    }

    state.playing = !audio.paused;
    state.currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    state.duration = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : state.track?.duration || state.duration;
    state.playbackRate = Number.isFinite(audio.playbackRate) ? audio.playbackRate : state.playbackRate;
    emitChange();
  };

  const bindAudio = (track) => {
    if (!track?.previewUrl) {
      audio = null;
      return null;
    }

    if (audio && audio.lytuneSrc === track.previewUrl) {
      return audio;
    }

    if (audio) {
      audio.pause();
    }

    audio = new Audio(track.previewUrl);
    audio.preload = "metadata";
    audio.lytuneSrc = track.previewUrl;
    audio.playbackRate = state.playbackRate;
    audio.addEventListener("loadedmetadata", syncFromAudio);
    audio.addEventListener("timeupdate", syncFromAudio);
    audio.addEventListener("play", syncFromAudio);
    audio.addEventListener("pause", syncFromAudio);
    audio.addEventListener("ratechange", syncFromAudio);
    audio.addEventListener("ended", () => {
      state.playing = false;
      state.currentTime = 0;
      state.notice = "Preview finished. Tap play to hear it again.";
      emitChange();
    });
    return audio;
  };

  const setTrack = (track, options = {}) => {
    const normalizedTrack = normalizeTrack(track);

    if (!normalizedTrack || !normalizedTrack.id) {
      return Promise.reject(new Error("Track metadata is incomplete."));
    }

    const isSameTrack = state.track && state.track.id === normalizedTrack.id;
    state.track = normalizedTrack;
    state.currentTime = options.resetTime === false && isSameTrack ? state.currentTime : 0;
    state.duration = normalizedTrack.duration || state.duration || 0;
    state.notice = normalizedTrack.previewUrl
      ? "Preview ready in Lytune."
      : "This track is in the catalog, but the preview is unavailable.";

    const nextAudio = bindAudio(normalizedTrack);
    if (nextAudio) {
      nextAudio.playbackRate = state.playbackRate;
      if (!isSameTrack || options.resetTime !== false) {
        nextAudio.currentTime = 0;
      }
    }

    emitChange();
    return Promise.resolve(cloneState());
  };

  const playCurrent = async () => {
    if (!state.track) {
      throw new Error("No track is loaded.");
    }

    const nextAudio = bindAudio(state.track);
    if (!nextAudio) {
      state.playing = false;
      state.notice = "This track has no preview attached yet.";
      emitChange();
      throw new Error("Preview unavailable.");
    }

    nextAudio.playbackRate = state.playbackRate;

    try {
      await nextAudio.play();
      state.notice = "Playing in Lytune.";
      syncFromAudio();
      return cloneState();
    } catch (error) {
      state.playing = false;
      state.notice = "Autoplay was blocked. Tap play again to start.";
      emitChange();
      throw error;
    }
  };

  const playTrack = async (track, options = {}) => {
    await setTrack(track, options);

    if (options.autoplay === false) {
      return cloneState();
    }

    return playCurrent();
  };

  const pause = () => {
    if (audio && !audio.paused) {
      audio.pause();
      state.notice = "Paused in Lytune.";
      syncFromAudio();
    }

    return cloneState();
  };

  const toggle = async (track = null, options = {}) => {
    if (track) {
      const normalizedTrack = normalizeTrack(track);
      const isSameTrack = state.track && normalizedTrack && state.track.id === normalizedTrack.id;

      if (isSameTrack && audio && !audio.paused) {
        pause();
        return cloneState();
      }

      return playTrack(normalizedTrack, options);
    }

    if (audio && !audio.paused) {
      pause();
      return cloneState();
    }

    return playCurrent();
  };

  const seek = (seconds) => {
    if (!audio || !Number.isFinite(Number(seconds))) {
      return cloneState();
    }

    audio.currentTime = Math.max(0, Number(seconds));
    syncFromAudio();
    return cloneState();
  };

  const setRate = (value) => {
    const nextRate = SPEED_OPTIONS.includes(Number(value)) ? Number(value) : 1;
    state.playbackRate = nextRate;

    if (audio) {
      audio.playbackRate = nextRate;
    }

    emitChange();
    return cloneState();
  };

  const cycleRate = () => {
    const currentIndex = SPEED_OPTIONS.indexOf(state.playbackRate);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % SPEED_OPTIONS.length : 1;
    return setRate(SPEED_OPTIONS[nextIndex]);
  };

  const clear = () => {
    if (audio) {
      audio.pause();
      audio = null;
    }

    state = {
      track: null,
      playing: false,
      currentTime: 0,
      duration: 0,
      playbackRate: 1,
      notice: "Pick a song to start listening in Lytune."
    };
    persistState();
    emitChange();
    return cloneState();
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    listener(cloneState());
    return () => {
      listeners.delete(listener);
    };
  };

  const createShell = () => {
    if (shell) {
      return shell;
    }

    shell = document.createElement("section");
    shell.className = "lytune-player-shell";
    shell.innerHTML = `
      <div class="lytune-player-track">
        <img class="lytune-player-art" src="assets/images/logo.png" alt="Now playing" data-player-art>
        <div class="lytune-player-copy">
          <span class="lytune-player-kicker" data-player-kicker>Now ready in Lytune</span>
          <span class="lytune-player-title" data-player-title>Lytune Player</span>
          <span class="lytune-player-subtitle" data-player-subtitle>Pick a song to begin</span>
          <span class="lytune-player-note" data-player-note>Preview playback lives here across the app.</span>
        </div>
      </div>

      <div class="lytune-player-center">
        <div class="lytune-player-controls">
          <button type="button" class="lytune-player-button primary" data-player-toggle aria-label="Play preview">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"></path></svg>
          </button>
        </div>
        <div class="lytune-player-progress">
          <span data-player-current>0:00</span>
          <input type="range" min="0" max="30" value="0" data-player-progress>
          <span data-player-duration>0:30</span>
        </div>
      </div>

      <div class="lytune-player-side">
        <button type="button" class="lytune-player-speed" data-player-speed aria-label="Playback speed 1.0x">1.0x</button>
        <a class="lytune-player-link" href="search.html" data-player-open data-player-ignore="true">Details</a>
        <button type="button" class="lytune-player-close" aria-label="Clear player" data-player-clear>&times;</button>
      </div>
    `;

    shell.querySelector("[data-player-toggle]").addEventListener("click", () => {
      toggle().catch(() => {});
    });
    shell.querySelector("[data-player-speed]").addEventListener("click", () => {
      cycleRate();
    });
    shell.querySelector("[data-player-progress]").addEventListener("input", (event) => {
      seek(event.target.value);
    });
    shell.querySelector("[data-player-clear]").addEventListener("click", () => {
      clear();
    });

    document.body.appendChild(shell);
    return shell;
  };

  const syncShellOffset = () => {
    const root = document.documentElement;
    const sidebar = document.querySelector(".sidebar");

    if (!sidebar || window.innerWidth <= 860) {
      root.style.setProperty("--lytune-player-left", "0px");
      return;
    }

    const sidebarWidth = Math.round(sidebar.getBoundingClientRect().width || 0);
    root.style.setProperty("--lytune-player-left", `${sidebarWidth}px`);
  };

  const buildTrackFromDetailPayload = (payload) => {
    const item = payload?.data;

    if (!item || item.type !== "track") {
      return null;
    }

    return {
      id: item.id,
      type: item.type,
      title: item.title,
      subtitle: item.artistName || item.subtitle,
      image: item.image,
      previewUrl: item.playback?.previewUrl || null,
      duration: item.playback?.durationSeconds || 0,
      bpm: item.playback?.bpm || null,
      link: item.link || null,
      contentUrl: buildContentUrl(item)
    };
  };

  const shouldInterceptTrackLink = (link, event) => {
    if (
      !link ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      link.target === "_blank" ||
      link.dataset.playerIgnore === "true"
    ) {
      return null;
    }

    const href = link.getAttribute("href");

    if (!href) {
      return null;
    }

    let targetUrl;

    try {
      targetUrl = new URL(href, window.location.href);
    } catch (error) {
      return null;
    }

    if (!/content\.html$/i.test(targetUrl.pathname)) {
      return null;
    }

    if (targetUrl.searchParams.get("type") !== "track") {
      return null;
    }

    return targetUrl;
  };

  const handleDocumentClick = async (event) => {
    const link = event.target.closest("a[href]");
    const targetUrl = shouldInterceptTrackLink(link, event);

    if (!targetUrl) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    const fallbackTrack = extractTrackMetadataFromLink(link, targetUrl);

    try {
      const query = new URLSearchParams({
        id: targetUrl.searchParams.get("id") || "",
        type: "track"
      });
      const payload = await fetchJsonFromCandidates(`/api/content-detail?${query.toString()}`);
      const track = buildTrackFromDetailPayload(payload) || fallbackTrack;

      if (!track) {
        return;
      }

      await playTrack(
        {
          ...fallbackTrack,
          ...track,
          contentUrl: fallbackTrack?.contentUrl || track.contentUrl || buildRelativeContentUrl(targetUrl)
        },
        {
          autoplay: Boolean(track.previewUrl || fallbackTrack?.previewUrl)
        }
      );
    } catch (error) {
      console.error("Could not start track from link:", error);

      if (!fallbackTrack) {
        return;
      }

      await playTrack(fallbackTrack, {
        autoplay: Boolean(fallbackTrack.previewUrl)
      }).catch(() => {});
    }
  };

  const onStorage = (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) {
      return;
    }

    try {
      const parsedValue = JSON.parse(event.newValue);
      state = {
        ...state,
        ...parsedValue,
        track: normalizeTrack(parsedValue.track),
        playing: false
      };
      emitChange();
    } catch (error) {
      console.error("Could not sync Lytune player state:", error);
    }
  };

  loadStoredState();
  createShell();
  syncShellOffset();
  render();
  document.addEventListener(
    "click",
    (event) => {
      handleDocumentClick(event);
    },
    true
  );
  window.addEventListener("storage", onStorage);
  window.addEventListener("resize", syncShellOffset);
  window.addEventListener("pagehide", () => {
    if (audio && !audio.paused) {
      audio.pause();
    }
  });

  window.LytunePlayer = {
    clear,
    getState: () => cloneState(),
    pause,
    playCurrent,
    playTrack,
    seek,
    setRate,
    subscribe,
    toggle
  };
})();
