const grid = document.getElementById("artistGrid");
const maxSelection = 5;
const selectionInfo = document.getElementById("selectionInfo");
const IMAGE_API_CANDIDATES = [
  "/api/artist-image",
  "http://lytune.localhost:3000/api/artist-image"
];
let isSavingSelection = false;

const placeholderImage = (name) =>
  `https://ui-avatars.com/api/?background=1c2dc7&color=fff&size=240&name=${encodeURIComponent(name)}`;

async function fetchArtistImage(name) {
  for (const endpoint of IMAGE_API_CANDIDATES) {
    try {
      const res = await fetch(`${endpoint}?name=${encodeURIComponent(name)}`);
      if (!res.ok) {
        continue;
      }

      const data = await res.json();
      if (data.imageUrl) {
        return data.imageUrl;
      }
    } catch {
      // Keep trying available endpoints before falling back.
    }
  }

  return placeholderImage(name);
}

const artistData = [
  { name: "Beyonce" },
  { name: "Kanye West" },
  { name: "Taylor Swift" },
  { name: "Ed Sheeran" },
  { name: "Justin Bieber" },
  { name: "Adele" },
  { name: "Bruno Mars" },
  { name: "Mavo" },
  { name: "Burna Boy" },
  { name: "Tems" },
  { name: "Rema" },
  { name: "Wizkid" },
  { name: "Davido" },
  { name: "Asake" },
  { name: "Ayra Starr" },
  { name: "Omah Lay" },
  { name: "Fireboy DML" },
  { name: "Joeboy" },
  { name: "Seyi Vibez" },
  { name: "BNXN" },
  { name: "Victony" },
  { name: "Kizz Daniel" },
  { name: "Drake" },
  { name: "Rihanna" },
  { name: "Travis Scott" },
  { name: "The Weeknd" },
  { name: "Doja Cat" },
  { name: "Olivia Rodrigo" },
  { name: "Billie Eilish" },
  { name: "Ariana Grande" },
  { name: "Central Cee" },
  { name: "Ice Spice" },
  { name: "Post Malone" },
  { name: "Bad Bunny" }
];

artistData.forEach(async (artist) => {
  const label = document.createElement("label");
  label.className = "artist";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.value = artist.name;

  const img = document.createElement("img");
  img.alt = artist.name;
  img.src = placeholderImage(artist.name);
  img.loading = "lazy";

  const span = document.createElement("span");
  span.textContent = artist.name;

  label.appendChild(checkbox);
  label.appendChild(img);
  label.appendChild(span);
  grid.appendChild(label);

  img.src = await fetchArtistImage(artist.name);
});

const setArtistInputsDisabled = (disabled) => {
  const inputs = grid.querySelectorAll("input");
  inputs.forEach((input) => {
    input.disabled = disabled;
  });
};

const persistArtistSelection = async (selectedInputs) => {
  if (isSavingSelection) {
    return;
  }

  isSavingSelection = true;
  const selectedArtists = Array.from(selectedInputs, (input) => input.value);

  localStorage.setItem("lytune_artists", JSON.stringify(selectedArtists));
  setArtistInputsDisabled(true);
  window.LytuneAuth?.setMessage("", "neutral");
  window.LytuneAuth?.showLoader();

  try {
    if (localStorage.getItem("authToken") && window.LytuneAuth?.updateProfile) {
      await window.LytuneAuth.updateProfile({
        favoriteArtists: selectedArtists
      });
    }

    setTimeout(() => {
      window.location.href = "welcome.html";
    }, 650);
  } catch (error) {
    isSavingSelection = false;
    setArtistInputsDisabled(false);
    window.LytuneAuth?.hideLoader();
    selectionInfo.textContent = error.message || "We could not save your artists. Please try again.";
  }
};

grid.addEventListener("change", async () => {
  const selected = grid.querySelectorAll("input:checked");
  const allLabels = grid.querySelectorAll(".artist");

  selectionInfo.textContent = `${selected.length} of ${maxSelection} selected`;

  if (selected.length >= maxSelection) {
    allLabels.forEach((label) => {
      const input = label.querySelector("input");
      if (!input.checked) {
        label.classList.add("disabled");
      }
    });
  } else {
    allLabels.forEach((label) => label.classList.remove("disabled"));
  }

  if (selected.length === maxSelection) {
    await persistArtistSelection(selected);
  }
});
