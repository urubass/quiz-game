# Quiz Game

A real-time online quiz game for 1–6 players. Run the server locally to play with friends.

## Requirements

- Node.js >=18

## Setup


1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
   or run:
   ```bash
   node server.js
   ```

The server will be available on `http://localhost:3000` by default.

When creating a game you can optionally specify question categories
as a comma separated list. Only questions matching those categories
will be used for the game. If no categories are provided, all
questions are eligible.

## Testing

Run the test suite with:

```bash
npm test
```

This runs the Jest tests in the `test` directory.

## Deployment on render.com

1. Create a new Web Service pointing to this repository.
2. Ensure the `PORT` environment variable is set (Render sets it automatically).
3. Use `npm start` as the start command.

Your service will then listen on the provided `PORT`.

## Scores API

Finished games are stored in `scores.json`. The endpoint `/scores` returns the last saved games and is used by the client to display a small leaderboard after each match.

