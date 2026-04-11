# Lytune

Lytune is a music streaming app prototype built with HTML, CSS, JavaScript, Node.js, Express, and SQLite-backed local app data. It includes a home page, search, player bar, podcasts, downloads, library views, and local authentication/profile flows.

## Features

- Music-style home, search, content, library, downloads, and podcast pages
- Persistent bottom player shared across pages
- Local account and session storage
- Google sign-in support when credentials are added
- Artist image lookup support when Google Custom Search is configured
- Express server for API routes and static file hosting
- SQLite-backed library, playlist, download, history, and moments storage

## Tech Stack

- HTML
- CSS
- JavaScript
- Node.js
- Express
- SQLite via Node's built-in `node:sqlite`

## Project Structure

```text
.
|- assets/
|- data/
|- home.html
|- search.html
|- content.html
|- library.html
|- downloads.html
|- podcast.html
|- player.js
|- player.css
|- server.js
|- package.json
```

## Getting Started


### 1. Install dependencies

```bash
npm install
```

### 2. Create your environment file

Copy `.env.example` to `.env` and add your own values:

```env
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_API_KEY=your-google-custom-search-key
GOOGLE_CX=your-google-custom-search-engine-id
```

If you do not want Google sign-in or artist image lookup yet, you can leave those values out and run the app with limited features.

### 3. Start the server

```bash
npm start
```

### 4. Open the app

Open:

```text
http://localhost:3000
```

The app may redirect to:

```text
http://lytune.localhost:3000
```

## Scripts

```bash
npm start
```


## Notes

- `.env` is not committed to GitHub. Use `.env.example` for shared setup.
- `node_modules` should not be uploaded to GitHub.
- local SQLite and JSON data files are ignored in `.gitignore`.
- This repository can be hosted on GitHub as source code, but the Express server will need a Node.js hosting platform for a live deployed app.

## Author

Built by the Adeyemi Jesse.
