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
   node server.js
   ```
   or use:
   ```bash
   npm start
   ```

The server will be available on `http://localhost:3000` by default.

## Adding Questions

Questions are stored in `questions.json` as an array of objects. Each question must now include two additional fields:

```json
{
  "text": "Question text?",
  "choices": ["A", "B", "C", "D"],
  "correct": 0,
  "category": "General",
  "difficulty": "medium"
}
```

`category` groups questions (e.g. Geography, History). `difficulty` can be `easy`, `medium` or `hard` and is used when filtering the deck for a new room.

Add new entries following the same structure.

