document.addEventListener("DOMContentLoaded", () => {
  const avatar = document.getElementById("avatar");
  const upload = document.getElementById("avatar-upload");
  const username = document.getElementById("username");
  const dropdown = document.getElementById("dropdown");
  const changeNameButton = document.getElementById("change-name");
  const logoutButton = document.getElementById("logout");
  const detailStatus = document.getElementById("detail-status");
  const detailHero = document.getElementById("detail-hero");
  const trackStage = document.getElementById("track-stage");
  const detailPanels = document.getElementById("detail-panels");
  const relatedGrid = document.getElementById("related-grid");
  const playerHeadline = document.getElementById("player-headline");
  const playerSubline = document.getElementById("player-subline");
  const playerToggle = document.getElementById("player-toggle");
  const playbackMode = document.getElementById("playback-mode");
  const bpmPill = document.getElementById("bpm-pill");
  const playerStatus = document.getElementById("player-status");
  const playerNote = document.getElementById("player-note");
  const tempoGroup = document.getElementById("tempo-group");
  const tempoStatus = document.getElementById("tempo-status");
  const progressRange = document.getElementById("progress-range");
  const currentTime = document.getElementById("current-time");
  const durationTime = document.getElementById("duration-time");
  const lyricsStatus = document.getElementById("lyrics-status");
  const lyricsLines = document.getElementById("lyrics-lines");
  const toggleLibraryActionButton = document.getElementById("toggle-library-action");
  const toggleDownloadActionButton = document.getElementById("toggle-download-action");
  const libraryActionLabel = document.getElementById("library-action-label");
  const downloadActionLabel = document.getElementById("download-action-label");
  const playlistSelect = document.getElementById("playlist-select");
  const addToPlaylistButton = document.getElementById("add-to-playlist");
  const newPlaylistTitle = document.getElementById("new-playlist-title");
  const createPlaylistButton = document.getElementById("create-playlist");
  const actionStatus = document.getElementById("action-status");
  const momentCard = document.getElementById("moment-card");
  const momentCopy = document.getElementById("moment-copy");
  const momentNote = document.getElementById("moment-note");
  const saveMomentButton = document.getElementById("save-moment");
  const momentStatus = document.getElementById("moment-status");
  const moodButtons = Array.from(document.querySelectorAll(".mood-chip"));
  const CONTENT_API_CANDIDATES = [
    "http://lytune.localhost:3000/api/content-detail",
    "/api/content-detail"
  ];
  const LYRICS_API_CANDIDATES = [
    "http://lytune.localhost:3000/api/lyrics",
    "/api/lyrics"
  ];
  const MOMENTS_API_CANDIDATES = [
    "http://lytune.localhost:3000/api/moments",
    "/api/moments"
  ];
  const MOMENTS_SAVE_API_CANDIDATES = [
    "http://lytune.localhost:3000/api/moments/upsert",
    "/api/moments/upsert"
  ];
  const HISTORY_ADD_API_CANDIDATES = [
    "http://lytune.localhost:3000/api/history/add",
    "/api/history/add"
  ];
  const LIBRARY_API_CANDIDATES = [
    "http://lytune.localhost:3000/api/library",
    "/api/library"
  ];
  const LIBRARY_TOGGLE_API_CANDIDATES = [
    "http://lytune.localhost:3000/api/library/toggle",
    "/api/library/toggle"
  ];
  const DOWNLOADS_API_CANDIDATES = [
    "http://lytune.localhost:3000/api/downloads",
    "/api/downloads"
  ];
  const DOWNLOADS_TOGGLE_API_CANDIDATES = [
    "http://lytune.localhost:3000/api/downloads/toggle",
    "/api/downloads/toggle"
  ];
  const PLAYLISTS_API_CANDIDATES = [
    "http://lytune.localhost:3000/api/playlists",
    "/api/playlists"
  ];
  const PLAYLISTS_CREATE_API_CANDIDATES = [
    "http://lytune.localhost:3000/api/playlists/create",
    "/api/playlists/create"
  ];
  const PLAYLISTS_ADD_API_CANDIDATES = [
    "http://lytune.localhost:3000/api/playlists/add-item",
    "/api/playlists/add-item"
  ];
  const params = new URLSearchParams(window.location.search);
  const contentId = params.get("id") || "";
  const contentType = params.get("type") || "";
  const autoPlayRequested = params.get("autoplay") === "1";

  let currentDetail = null;
  let currentLyrics = [];
  let lyricsAreSynced = false;
  let currentLyricIndex = -1;
  let activeAudio = null;
  let activePlaybackRate = 1;
  let selectedMood = "";
  let autoplayAttempted = false;
  let actionState = {
    saved: false,
    downloaded: false,
    playlists: []
  };
  const playerApi = window.LytunePlayer || null;
  const historyLoggedFor = new Set();

  const formatType = (type) => {
    if (type === "track") return "Song";
    if (type === "artist") return "Artist";
    if (type === "album") return "Album";
    if (type === "playlist") return "Playlist";
    return "Podcast";
  };

  const escapeHtml = (value = "") =>
    String(value).replace(/[&<>"']/g, (character) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
      };

      return entities[character] || character;
    });

  const formatTime = (value) => {
    const safeValue = Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
    const minutes = Math.floor(safeValue / 60);
    const seconds = Math.floor(safeValue % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  const formatPlaybackRate = (value) => {
    const safeValue = Number(value);

    if (!Number.isFinite(safeValue)) {
      return "1.0x";
    }

    return `${safeValue.toFixed(Number.isInteger(safeValue) ? 1 : 2).replace(/0$/, "")}x`;
  };

  const formatUpdatedAt = (value) => {
    if (!value) {
      return "just now";
    }

    try {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(new Date(value));
    } catch (error) {
      return "recently";
    }
  };

  const buildContentUrl = (type, id) => {
    const query = new URLSearchParams({
      type,
      id
    });

    if (type === "track") {
      query.set("autoplay", "1");
    }

    return `content.html?${query.toString()}`;
  };

  const getUserContext = () => ({
    user:
      localStorage.getItem("userEmail") ||
      localStorage.getItem("signupEmail") ||
      localStorage.getItem("username") ||
      "guest",
    displayName: localStorage.getItem("username") || "Guest Listener"
  });

  const createUserHeaders = (includeJson = false) => {
    const userContext = getUserContext();
    const headers = {
      "x-lytune-user": userContext.user,
      "x-lytune-user-name": userContext.displayName
    };

    if (includeJson) {
      headers["Content-Type"] = "application/json";
    }

    return headers;
  };

  const fetchWithTimeout = async (url, options = {}, timeoutMs = 6500) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const fetchJsonFromCandidates = async (
    candidates,
    buildUrl,
    options = {},
    timeoutMs = 6500
  ) => {
    let lastError = null;

    for (const baseUrl of candidates) {
      try {
        const response = await fetchWithTimeout(buildUrl(baseUrl), options, timeoutMs);

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

  const syncProfile = () => {
    const savedAvatar = localStorage.getItem("avatar");
    const savedName = localStorage.getItem("username");

    if (savedAvatar) {
      avatar.src = savedAvatar;
    }

    if (savedName) {
      username.textContent = savedName;
    }
  };

  const updatePlayButton = (playing) => {
    playerToggle.textContent = playing ? "Pause preview" : "Play preview";
    playerToggle.setAttribute("aria-pressed", playing ? "true" : "false");
  };

  const setPlayerStatus = (message) => {
    playerStatus.textContent = message;
  };

  const setSelectedMood = (mood) => {
    selectedMood = mood || "";
    moodButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.mood === selectedMood);
    });
  };

  const isCurrentPlayerTrack = (playerState = playerApi?.getState?.()) =>
    Boolean(currentDetail && playerState?.track && playerState.track.id === currentDetail.id);

  const getCurrentTrackPayload = () => {
    if (!currentDetail || currentDetail.type !== "track") {
      return null;
    }

    return {
      id: currentDetail.id,
      type: currentDetail.type,
      title: currentDetail.title,
      subtitle: currentDetail.artistName || currentDetail.subtitle,
      image: currentDetail.image,
      previewUrl: currentDetail.playback?.previewUrl || null,
      duration: currentDetail.playback?.durationSeconds || 0,
      bpm: currentDetail.playback?.bpm || null,
      link: currentDetail.link || null,
      contentUrl: buildContentUrl(currentDetail.type, currentDetail.id)
    };
  };

  const clearAudio = () => {
    if (playerApi) {
      activeAudio = null;
      updatePlayButton(false);
      progressRange.value = "0";
      currentTime.textContent = "0:00";
      highlightCurrentLyric(-1);
      return;
    }

    if (activeAudio) {
      activeAudio.pause();
      activeAudio.src = "";
    }

    activeAudio = null;
    updatePlayButton(false);
    progressRange.value = "0";
    currentTime.textContent = "0:00";
  };

  const highlightCurrentLyric = (nextIndex) => {
    currentLyricIndex = nextIndex;
    const lyricNodes = Array.from(lyricsLines.querySelectorAll(".lyric-line"));

    lyricNodes.forEach((node, index) => {
      node.classList.toggle("active", index === nextIndex);
    });
  };

  const syncProgress = () => {
    const fallbackDuration = currentDetail?.playback?.durationSeconds || 30;
    const playerState = playerApi?.getState?.() || null;
    const usingSharedPlayer = isCurrentPlayerTrack(playerState);
    const sharedCurrentTime = usingSharedPlayer ? playerState.currentTime || 0 : 0;
    const sharedDuration = usingSharedPlayer ? playerState.duration || fallbackDuration : fallbackDuration;
    const liveDuration =
      usingSharedPlayer
        ? sharedDuration
        : activeAudio && Number.isFinite(activeAudio.duration) && activeAudio.duration > 0
        ? activeAudio.duration
        : fallbackDuration;
    const liveCurrentTime = usingSharedPlayer ? sharedCurrentTime : activeAudio?.currentTime || 0;

    progressRange.max = String(Math.max(30, Math.round(liveDuration)));
    progressRange.value = String(
      Math.min(
        Math.round(liveCurrentTime || 0),
        Math.max(30, Math.round(liveDuration))
      )
    );
    currentTime.textContent = formatTime(liveCurrentTime || 0);
    durationTime.textContent = formatTime(liveDuration);

    if (!lyricsAreSynced || !currentLyrics.length) {
      return;
    }

    let nextIndex = -1;
    currentLyrics.forEach((line, index) => {
      if (typeof line.time === "number" && line.time <= (liveCurrentTime || 0) + 0.15) {
        nextIndex = index;
      }
    });

    if (nextIndex !== currentLyricIndex) {
      highlightCurrentLyric(nextIndex);
    }
  };

  const ensureAudioSource = (previewUrl) => {
    if (playerApi) {
      return playerApi.getState?.() || null;
    }

    if (!previewUrl) {
      clearAudio();
      return null;
    }

    if (activeAudio && activeAudio.lytuneSrc === previewUrl) {
      return activeAudio;
    }

    clearAudio();
    const audio = new Audio(previewUrl);
    audio.preload = "metadata";
    audio.lytuneSrc = previewUrl;
    audio.playbackRate = activePlaybackRate;
    audio.addEventListener("timeupdate", syncProgress);
    audio.addEventListener("loadedmetadata", syncProgress);
    audio.addEventListener("ended", () => {
      updatePlayButton(false);
      setPlayerStatus("Preview finished. Tap play to hear it again.");
      highlightCurrentLyric(-1);
    });
    activeAudio = audio;
    syncProgress();
    return audio;
  };

  const applyPlaybackRate = (value) => {
    activePlaybackRate = value;

    if (playerApi && isCurrentPlayerTrack()) {
      playerApi.setRate(value);
    }

    if (activeAudio) {
      activeAudio.playbackRate = value;
    }

    Array.from(tempoGroup.querySelectorAll(".tempo-chip")).forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.rate) === value);
    });
    tempoStatus.textContent = `${formatPlaybackRate(value)} tempo`;
  };

  const renderTempoButtons = (values = []) => {
    const options = values.length ? values : [0.85, 1, 1.15, 1.3, 1.5];
    tempoGroup.innerHTML = "";

    options.forEach((value) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tempo-chip";
      button.dataset.rate = String(value);
      button.textContent = formatPlaybackRate(value);
      button.addEventListener("click", () => {
        applyPlaybackRate(value);
      });
      tempoGroup.appendChild(button);
    });

    const playerState = playerApi?.getState?.() || null;
    const startingRate = isCurrentPlayerTrack(playerState)
      ? playerState.playbackRate || 1
      : 1;
    applyPlaybackRate(startingRate);
  };

  const logHistoryPlay = async () => {
    if (!currentDetail || historyLoggedFor.has(currentDetail.id)) {
      return;
    }

    historyLoggedFor.add(currentDetail.id);

    try {
      await fetchJsonFromCandidates(
        HISTORY_ADD_API_CANDIDATES,
        (baseUrl) => baseUrl,
        {
          method: "POST",
          headers: createUserHeaders(true),
          body: JSON.stringify({
            contentId: currentDetail.id,
            type: currentDetail.type
          })
        }
      );
    } catch (error) {
      historyLoggedFor.delete(currentDetail.id);
      console.error("Could not log playback history:", error);
    }
  };

  const syncPlayerState = (playerState = playerApi?.getState?.()) => {
    if (!currentDetail || currentDetail.type !== "track") {
      return;
    }

    const activeMatch = isCurrentPlayerTrack(playerState);

    if (activeMatch) {
      activePlaybackRate = playerState.playbackRate || activePlaybackRate;
      updatePlayButton(Boolean(playerState.playing));
      tempoStatus.textContent = `${formatPlaybackRate(activePlaybackRate)} tempo`;
      setPlayerStatus(
        playerState.notice ||
          (playerState.playing ? "Track preview is playing in Lytune." : "Preview paused.")
      );
    } else {
      updatePlayButton(false);
    }

    syncProgress();
  };

  const startPlayback = async (autoplayMode = false) => {
    if (!currentDetail?.playback?.previewUrl) {
      setPlayerStatus("This song is in the catalog, but it does not have a playable preview yet.");
      return;
    }

    if (playerApi) {
      try {
        const playerState = await playerApi.playTrack(getCurrentTrackPayload(), {
          autoplay: true
        });
        syncPlayerState(playerState);
        setPlayerStatus(
          autoplayMode
            ? "Track preview started automatically in Lytune."
            : "Track preview is playing in Lytune."
        );
        await logHistoryPlay();
      } catch (error) {
        syncPlayerState(playerApi.getState?.());
        setPlayerStatus(
          autoplayMode
            ? "Autoplay was blocked. Tap play once to start the preview."
            : "Playback could not start right now. Try again."
        );
      }
      return;
    }

    const audio = ensureAudioSource(currentDetail.playback.previewUrl);

    try {
      await audio.play();
      updatePlayButton(true);
      setPlayerStatus(
        autoplayMode
          ? "Track preview started automatically in Lytune."
          : "Track preview is playing in Lytune."
      );
      await logHistoryPlay();
    } catch (error) {
      updatePlayButton(false);
      setPlayerStatus(
        autoplayMode
          ? "Autoplay was blocked. Tap play once to start the preview."
          : "Playback could not start right now. Try again."
      );
    }
  };

  const togglePlayback = async () => {
    if (playerApi) {
      const playerState = playerApi.getState?.() || null;

      if (isCurrentPlayerTrack(playerState) && playerState.playing) {
        playerApi.pause();
        syncPlayerState(playerApi.getState?.());
        setPlayerStatus("Preview paused.");
        return;
      }

      await startPlayback(false);
      return;
    }

    if (activeAudio && !activeAudio.paused) {
      activeAudio.pause();
      updatePlayButton(false);
      setPlayerStatus("Preview paused.");
      return;
    }

    await startPlayback(false);
  };

  const renderLyrics = (payload) => {
    currentLyrics = Array.isArray(payload.lines) ? payload.lines : [];
    lyricsAreSynced = Boolean(payload.synced && currentLyrics.length);
    currentLyricIndex = -1;
    lyricsLines.classList.toggle("plain-lyrics", !lyricsAreSynced);
    lyricsStatus.textContent =
      payload.message ||
      (currentLyrics.length ? "Lyrics loaded for this track." : "Lyrics are not available yet.");
    lyricsLines.innerHTML = "";

    if (!currentLyrics.length) {
      lyricsLines.innerHTML = `
        <p class="lyrics-empty">${escapeHtml(payload.message || "Lyrics are not available yet.")}</p>
      `;
      return;
    }

    currentLyrics.forEach((line, index) => {
      const lyricLine = document.createElement("p");
      lyricLine.className = "lyric-line";
      lyricLine.dataset.index = String(index);
      lyricLine.textContent = line.text;
      lyricsLines.appendChild(lyricLine);
    });

    syncProgress();
  };

  const loadLyrics = async () => {
    if (currentDetail?.type !== "track") {
      renderLyrics({
        synced: false,
        lines: [],
        message: "Open a song to load lyrics here."
      });
      return;
    }

    renderLyrics({
      synced: false,
      lines: [],
      message: "Looking for lyrics..."
    });

    try {
      const query = new URLSearchParams({
        id: currentDetail.id,
        type: currentDetail.type
      });
      const payload = await fetchJsonFromCandidates(
        LYRICS_API_CANDIDATES,
        (baseUrl) => `${baseUrl}?${query.toString()}`
      );
      renderLyrics(payload);
    } catch (error) {
      console.error("Lyrics API unavailable:", error);
      renderLyrics({
        synced: false,
        lines: [],
        message: "Lyrics could not be loaded right now."
      });
    }
  };

  const applyMoment = (payload) => {
    momentNote.value = payload?.note || "";
    setSelectedMood(payload?.mood || "");
    momentStatus.textContent = payload?.updatedAt
      ? `Saved ${formatUpdatedAt(payload.updatedAt)}.`
      : "Save a note so this song keeps the memory beside it.";
  };

  const loadMoment = async () => {
    if (!currentDetail) {
      return;
    }

    momentStatus.textContent = "Loading your saved Lytune Moment...";

    try {
      const query = new URLSearchParams({
        contentId: currentDetail.id
      });
      const payload = await fetchJsonFromCandidates(
        MOMENTS_API_CANDIDATES,
        (baseUrl) => `${baseUrl}?${query.toString()}`,
        {
          headers: createUserHeaders()
        }
      );
      applyMoment(payload.data || payload);
    } catch (error) {
      console.error("Moments API unavailable:", error);
      momentStatus.textContent = "Your saved note could not be loaded right now.";
    }
  };

  const saveMoment = async () => {
    if (!currentDetail) {
      return;
    }

    momentStatus.textContent = "Saving your Lytune Moment...";

    try {
      const payload = await fetchJsonFromCandidates(
        MOMENTS_SAVE_API_CANDIDATES,
        (baseUrl) => baseUrl,
        {
          method: "POST",
          headers: createUserHeaders(true),
          body: JSON.stringify({
            contentId: currentDetail.id,
            mood: selectedMood,
            note: momentNote.value.trim()
          })
        }
      );
      applyMoment(payload.data || payload);
    } catch (error) {
      console.error("Could not save moment:", error);
      momentStatus.textContent = "Your note could not be saved right now.";
    }
  };

  const setActionMessage = (message) => {
    actionStatus.textContent = message;
  };

  const renderPlaylistOptions = () => {
    playlistSelect.innerHTML = '<option value="">Choose a playlist</option>';

    (actionState.playlists || []).forEach((playlist) => {
      const option = document.createElement("option");
      option.value = playlist.id;
      option.textContent = `${playlist.title} (${playlist.itemCount || 0})`;
      playlistSelect.appendChild(option);
    });

    addToPlaylistButton.disabled = !actionState.playlists.length;
  };

  const renderActionState = () => {
    libraryActionLabel.textContent = actionState.saved ? "Saved in library" : "Save song";
    downloadActionLabel.textContent = actionState.downloaded ? "Downloaded offline" : "Download song";
    renderPlaylistOptions();
  };

  const loadActionState = async () => {
    if (!currentDetail || currentDetail.type !== "track") {
      return;
    }

    setActionMessage("Loading save, download, and playlist state...");

    try {
      const [libraryPayload, downloadsPayload, playlistsPayload] = await Promise.all([
        fetchJsonFromCandidates(LIBRARY_API_CANDIDATES, (baseUrl) => baseUrl, {
          headers: createUserHeaders()
        }),
        fetchJsonFromCandidates(DOWNLOADS_API_CANDIDATES, (baseUrl) => baseUrl, {
          headers: createUserHeaders()
        }),
        fetchJsonFromCandidates(PLAYLISTS_API_CANDIDATES, (baseUrl) => baseUrl, {
          headers: createUserHeaders()
        })
      ]);

      actionState.saved = Boolean(libraryPayload.data?.savedItemIds?.includes(currentDetail.id));
      actionState.downloaded = Boolean(
        downloadsPayload.data?.ready?.some((entry) => entry.id === currentDetail.id)
      );
      actionState.playlists = Array.isArray(playlistsPayload.data) ? playlistsPayload.data : [];
      renderActionState();
      setActionMessage("Song actions are ready inside your Lytune account.");
    } catch (error) {
      console.error("Content action state unavailable:", error);
      setActionMessage("Song actions could not be loaded right now.");
    }
  };

  const toggleLibraryAction = async () => {
    if (!currentDetail || currentDetail.type !== "track") {
      return;
    }

    setActionMessage(actionState.saved ? "Removing song from your library..." : "Saving song to your library...");

    try {
      const payload = await fetchJsonFromCandidates(
        LIBRARY_TOGGLE_API_CANDIDATES,
        (baseUrl) => baseUrl,
        {
          method: "POST",
          headers: createUserHeaders(true),
          body: JSON.stringify({
            contentId: currentDetail.id,
            type: currentDetail.type
          })
        }
      );

      actionState.saved = Boolean(payload.saved);
      if (payload.data?.savedItemIds) {
        actionState.saved = payload.data.savedItemIds.includes(currentDetail.id);
      }
      renderActionState();
      setActionMessage(
        actionState.saved
          ? "Song saved into your Lytune library."
          : "Song removed from your Lytune library."
      );
    } catch (error) {
      console.error("Could not update library state:", error);
      setActionMessage("Library action failed right now.");
    }
  };

  const toggleDownloadAction = async () => {
    if (!currentDetail || currentDetail.type !== "track") {
      return;
    }

    setActionMessage(actionState.downloaded ? "Removing song from downloads..." : "Saving song for offline listening...");

    try {
      const payload = await fetchJsonFromCandidates(
        DOWNLOADS_TOGGLE_API_CANDIDATES,
        (baseUrl) => baseUrl,
        {
          method: "POST",
          headers: createUserHeaders(true),
          body: JSON.stringify({
            contentId: currentDetail.id,
            type: currentDetail.type
          })
        }
      );

      actionState.downloaded = Boolean(payload.downloaded);
      if (payload.data?.ready) {
        actionState.downloaded = payload.data.ready.some((entry) => entry.id === currentDetail.id);
      }
      renderActionState();
      setActionMessage(
        actionState.downloaded
          ? "Song is ready for offline listening."
          : "Song removed from offline downloads."
      );
    } catch (error) {
      console.error("Could not update download state:", error);
      setActionMessage("Download action failed right now.");
    }
  };

  const addTrackToPlaylist = async () => {
    if (!currentDetail || currentDetail.type !== "track") {
      return;
    }

    const selectedPlaylistId = playlistSelect.value;

    if (!selectedPlaylistId) {
      setActionMessage("Choose a playlist first.");
      return;
    }

    setActionMessage("Adding song to your playlist...");

    try {
      const payload = await fetchJsonFromCandidates(
        PLAYLISTS_ADD_API_CANDIDATES,
        (baseUrl) => baseUrl,
        {
          method: "POST",
          headers: createUserHeaders(true),
          body: JSON.stringify({
            playlistId: selectedPlaylistId,
            contentId: currentDetail.id,
            type: currentDetail.type
          })
        }
      );

      actionState.playlists = Array.isArray(payload.data) ? payload.data : actionState.playlists;
      renderActionState();
      playlistSelect.value = selectedPlaylistId;
      setActionMessage(
        payload.added
          ? "Song added to your playlist."
          : "That song is already in the selected playlist."
      );
    } catch (error) {
      console.error("Could not add song to playlist:", error);
      setActionMessage("Playlist action failed right now.");
    }
  };

  const createPlaylistWithTrack = async () => {
    if (!currentDetail || currentDetail.type !== "track") {
      return;
    }

    const title = newPlaylistTitle.value.trim();

    if (!title) {
      setActionMessage("Enter a playlist name first.");
      return;
    }

    setActionMessage("Creating playlist and adding this song...");

    try {
      const payload = await fetchJsonFromCandidates(
        PLAYLISTS_CREATE_API_CANDIDATES,
        (baseUrl) => baseUrl,
        {
          method: "POST",
          headers: createUserHeaders(true),
          body: JSON.stringify({
            title,
            description: `${currentDetail.title} started this playlist inside Lytune.`,
            contentId: currentDetail.id,
            type: currentDetail.type
          })
        }
      );

      actionState.playlists = Array.isArray(payload.data) ? payload.data : actionState.playlists;
      renderActionState();
      if (payload.createdPlaylistId) {
        playlistSelect.value = payload.createdPlaylistId;
      }
      newPlaylistTitle.value = "";
      setActionMessage("Playlist created and this song was added.");
    } catch (error) {
      console.error("Could not create playlist:", error);
      setActionMessage("Playlist could not be created right now.");
    }
  };

  const renderInsightPanels = (item) => {
    if (item.type === "track") {
      detailPanels.innerHTML = `
        <article class="panel-card">
          <p class="related-kicker">Playback note</p>
          <h3>Listening stays inside Lytune</h3>
          <p>
            ${
              item.playback?.previewUrl
                ? "This track can already start inside Lytune with the connected preview source, then continue with lyrics and tempo controls on the same page."
                : "This track is in your catalog already, and the player is ready. It just needs an audio source before playback can start."
            }
          </p>
          <p>
            The page is built so a stronger streaming source can be plugged in later without redesigning the whole listening flow.
          </p>
        </article>

        <article class="panel-card">
          <p class="related-kicker">Only on Lytune</p>
          <h3>Why the Moment card matters</h3>
          <p>
            Most streaming apps remember what you played. Lytune can also remember why it mattered, so a replay carries the memory, not just the timestamp.
          </p>
          <ul class="insight-list">
            <li>Save a mood or small memory beside the song.</li>
            <li>Keep that note tied to the track instead of losing it in chat or notes apps.</li>
            <li>Build a listening history that feels personal, not just statistical.</li>
          </ul>
        </article>
      `;
      return;
    }

    detailPanels.innerHTML = `
      <article class="panel-card">
        <p class="related-kicker">Inside Lytune</p>
        <h3>This content now has a proper home</h3>
        <p>
          Songs, albums, artists, playlists, and podcasts all route into an internal Lytune page now, so content no longer feels like a dead end.
        </p>
        <p>
          It also gives the app a stronger long-term structure, because deeper experiences can grow from one consistent content destination.
        </p>
      </article>

      <article class="panel-card">
        <p class="related-kicker">Next growth step</p>
        <h3>What we can keep building</h3>
        <ul class="insight-list">
          <li>Add saves, downloads, and history actions directly on this page.</li>
          <li>Expand artist, album, and playlist layouts without changing the overall shell.</li>
          <li>Connect richer backend data later without rebuilding the frontend again.</li>
        </ul>
      </article>
    `;
  };

  const renderRelated = (items) => {
    relatedGrid.innerHTML = "";

    if (!Array.isArray(items) || !items.length) {
      relatedGrid.innerHTML = `
        <article class="related-card related-empty">
          <span class="related-title">No related content yet</span>
          <span class="related-subtitle">Open search or home to keep exploring the catalog.</span>
        </article>
      `;
      return;
    }

    items.forEach((entry) => {
      const card = document.createElement("a");
      card.className = "related-card";
      card.href = buildContentUrl(entry.type, entry.id);
      card.innerHTML = `
        <img src="${escapeHtml(entry.image)}" alt="${escapeHtml(entry.title)}">
        <span class="related-type">${escapeHtml(formatType(entry.type))}</span>
        <span class="related-title">${escapeHtml(entry.title)}</span>
        <span class="related-subtitle">${escapeHtml(entry.subtitle)}</span>
      `;
      relatedGrid.appendChild(card);
    });
  };

  const bindHeroActions = () => {
    const heroPlayButton = document.getElementById("hero-play-button");
    const heroMomentButton = document.getElementById("hero-moment-button");

    if (heroPlayButton) {
      heroPlayButton.addEventListener("click", () => {
        togglePlayback();
      });
    }

    if (heroMomentButton) {
      heroMomentButton.addEventListener("click", () => {
        momentCard.scrollIntoView({ behavior: "smooth", block: "start" });
        momentNote.focus();
      });
    }
  };

  const renderDetail = (payload) => {
    const item = payload.data;
    currentDetail = item;
    autoplayAttempted = false;
    document.title = `Lytune - ${item.title}`;
    detailStatus.textContent =
      item.source === "live"
        ? "Showing live content details routed through the Lytune backend."
        : "Showing saved content details routed through the Lytune backend.";

    const previewCopy =
      item.type === "track"
        ? item.playback?.previewUrl
          ? "This page can play the connected track preview, show lyrics when they are available, and let you stretch the tempo without leaving Lytune."
          : "This page is ready for playback, but the connected catalog did not send a preview file for this track."
        : "This content now has a stronger internal destination inside Lytune.";
    const externalButton = item.link
      ? `<a href="${escapeHtml(item.link)}" class="secondary-link" target="_blank" rel="noopener noreferrer">Open source link</a>`
      : `<a href="search.html" class="secondary-link">Back to search</a>`;

    detailHero.innerHTML = `
      <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" class="detail-cover">
      <div class="hero-copy">
        <div class="hero-topline">
          <p class="detail-kicker">${escapeHtml(formatType(item.type))}</p>
          <span class="source-badge">${escapeHtml(item.source === "live" ? "Live catalog" : "Saved catalog")}</span>
        </div>
        <h1 class="detail-title">${escapeHtml(item.title)}</h1>
        <p class="detail-subtitle">${escapeHtml(item.subtitle)}</p>
        <p class="detail-description">${escapeHtml(item.description)}</p>
        <p class="detail-listening-note">${escapeHtml(previewCopy)}</p>
        <div class="detail-meta">
          ${item.meta.map((entry) => `<span class="meta-pill">${escapeHtml(entry)}</span>`).join("")}
        </div>
        <div class="detail-actions">
          ${
            item.type === "track"
              ? '<button type="button" class="primary-link action-button" id="hero-play-button">Play preview</button>'
              : '<a href="search.html" class="primary-link">Explore more</a>'
          }
          ${
            item.type === "track"
              ? '<button type="button" class="secondary-link action-button" id="hero-moment-button">Write a Lytune Moment</button>'
              : '<a href="home.html" class="secondary-link">Back to home</a>'
          }
          ${externalButton}
        </div>
      </div>
    `;

    bindHeroActions();
    renderInsightPanels(item);
    renderRelated(payload.related || []);

    if (item.type === "track") {
      trackStage.hidden = false;
      playerHeadline.textContent = `Play ${item.title}`;
      playerSubline.textContent = item.artistName || item.subtitle || "Track";
      playerNote.textContent = item.playback?.previewUrl
        ? "Lytune is using the available preview clip from the connected catalog. Full-song streaming can plug in later without changing this page."
        : "This song is in the catalog, but there is no playable preview attached yet.";
      playbackMode.textContent = item.playback?.previewUrl ? "Preview playback" : "Catalog only";
      bpmPill.hidden = !item.playback?.bpm;
      bpmPill.textContent = item.playback?.bpm ? `${item.playback.bpm} BPM` : "";
      progressRange.max = String(Math.max(30, item.playback?.durationSeconds || 30));
      progressRange.value = "0";
      currentTime.textContent = "0:00";
      durationTime.textContent = formatTime(item.playback?.durationSeconds || 30);
      momentCopy.textContent =
        item.experience?.notePrompt ||
        "Capture the room, mood, or reason this track matters today. Lytune keeps that note beside the music.";
      renderTempoButtons(item.playback?.speedOptions || []);
      ensureAudioSource(item.playback?.previewUrl || "");
      syncPlayerState(playerApi?.getState?.());
      setPlayerStatus(
        item.playback?.previewUrl
          ? autoPlayRequested
            ? "Opening track and preparing playback..."
            : "Tap play to start the track preview."
          : "This song is in the catalog, but it does not have a playable preview yet."
      );
      actionState = {
        saved: false,
        downloaded: false,
        playlists: []
      };
      newPlaylistTitle.value = "";
      playlistSelect.value = "";
      renderActionState();
      loadActionState();
      loadLyrics();
      loadMoment();

      if (autoPlayRequested && item.playback?.previewUrl && !autoplayAttempted) {
        autoplayAttempted = true;
        window.setTimeout(() => {
          startPlayback(true);
        }, 180);
      }

      return;
    }

    trackStage.hidden = true;
    clearAudio();
    renderLyrics({
      synced: false,
      lines: [],
      message: "Open a song to load lyrics here."
    });
    momentNote.value = "";
    setSelectedMood("");
    momentStatus.textContent = "Open a song to save a Lytune Moment.";
    newPlaylistTitle.value = "";
    playlistSelect.value = "";
    actionState = {
      saved: false,
      downloaded: false,
      playlists: []
    };
    renderActionState();
    setActionMessage("Open a song to save, download, or add it to a playlist.");
  };

  const renderMissing = (message) => {
    currentDetail = null;
    detailStatus.textContent = message;
    detailHero.innerHTML = `
      <img src="assets/images/logo.png" alt="Lytune" class="detail-cover">
      <div class="hero-copy">
        <p class="detail-kicker">Content</p>
        <h1 class="detail-title">This content could not be loaded.</h1>
        <p class="detail-description">${escapeHtml(message)}</p>
        <div class="detail-actions">
          <a href="home.html" class="primary-link">Back to home</a>
          <a href="search.html" class="secondary-link">Open search</a>
        </div>
      </div>
    `;
    trackStage.hidden = true;
    detailPanels.innerHTML = "";
    relatedGrid.innerHTML = "";
    clearAudio();
  };

  const loadDetail = async () => {
    if (!contentId) {
      renderMissing("No content id was provided.");
      return;
    }

    try {
      const query = new URLSearchParams({
        id: contentId,
        type: contentType
      });
      const payload = await fetchJsonFromCandidates(
        CONTENT_API_CANDIDATES,
        (baseUrl) => `${baseUrl}?${query.toString()}`
      );
      renderDetail(payload);
    } catch (error) {
      console.error("Content detail API unavailable:", error);
      renderMissing("The Lytune backend could not load this content detail right now.");
    }
  };

  playerToggle.addEventListener("click", () => {
    togglePlayback();
  });

  progressRange.addEventListener("input", () => {
    if (playerApi && isCurrentPlayerTrack()) {
      playerApi.seek(Number(progressRange.value));
      syncProgress();
      return;
    }

    if (!activeAudio) {
      return;
    }

    activeAudio.currentTime = Number(progressRange.value);
    syncProgress();
  });

  moodButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setSelectedMood(selectedMood === button.dataset.mood ? "" : button.dataset.mood);
    });
  });

  saveMomentButton.addEventListener("click", () => {
    saveMoment();
  });

  toggleLibraryActionButton.addEventListener("click", () => {
    toggleLibraryAction();
  });

  toggleDownloadActionButton.addEventListener("click", () => {
    toggleDownloadAction();
  });

  addToPlaylistButton.addEventListener("click", () => {
    addTrackToPlaylist();
  });

  createPlaylistButton.addEventListener("click", () => {
    createPlaylistWithTrack();
  });

  newPlaylistTitle.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createPlaylistWithTrack();
    }
  });

  renderActionState();
  setActionMessage("Open a song to save, download, or add it to a playlist.");
  syncProfile();
  loadDetail();

  if (playerApi?.subscribe) {
    playerApi.subscribe((playerState) => {
      syncPlayerState(playerState);
    });
  }

  avatar.addEventListener("click", (event) => {
    event.stopPropagation();
    dropdown.classList.toggle("show");
  });

  upload.addEventListener("change", function () {
    const file = this.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function () {
      avatar.src = reader.result;
      localStorage.setItem("avatar", reader.result);
    };

    reader.readAsDataURL(file);
    dropdown.classList.remove("show");
  });

  changeNameButton.addEventListener("click", () => {
    const newName = prompt("Enter your name:", username.textContent);
    if (!newName || !newName.trim()) return;

    username.textContent = newName.trim();
    localStorage.setItem("username", newName.trim());
    dropdown.classList.remove("show");
  });

  logoutButton.addEventListener("click", () => {
    localStorage.clear();
    window.location.reload();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".user-profile")) {
      dropdown.classList.remove("show");
    }
  });

});
