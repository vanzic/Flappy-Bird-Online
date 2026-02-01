# Chat Application

A real-time chat application built with Vanilla JS and Supabase.

## Features

- **Authentication**: Email/Password login and signup.
- **Real-time Messaging**: Instant message delivery using Supabase Realtime.
- **Friend System**: Search users by nickname, send/accept/decline friend requests.
- **Responsive Design**: Mobile-first UI that works on desktop and mobile.
- **PWA Ready**: Installable on mobile devices.

## Setup

1.  Clone the repository.
2.  Open `index.html` in a browser (or serve with a local server like `live-server` or `python -m http.server`).

## Architecture

- `index.html`: Entry point.
- `ui.js`: Handles all UI logic, event listeners, and DOM manipulation.
- `supabase.js`: Data layer wrapper for Supabase SDK.
- `style.css`: All application styles.
