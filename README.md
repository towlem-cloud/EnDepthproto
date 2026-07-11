# EnDepth interactive prototype

A front-end prototype for a private Harkness preparation tool. It contains:

- An overview/landing page
- An interactive student workflow
- A mocked teacher dashboard
- A qualitative Thinking Snapshot rather than a numerical score
- A simulated Socratic coach (no live AI or backend yet)

## Use inside an existing CodeSandbox React project

1. Replace the contents of `src/App.js` (or `src/App.jsx`) with `src/App.jsx` from this repository.
2. Create or replace `src/styles.css` with the included stylesheet.
3. Confirm the first two lines of the app are:

```jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
```

No additional packages are required beyond React.

## Run this full project locally or in CodeSandbox

```bash
npm install
npm run dev
```

## Current prototype limits

The coach logic and teacher roster are mocked in the browser. No student data is transmitted. The student workspace uses browser `localStorage` to preserve the preview on the same device. A production version still needs authentication, a database, secure server routes, privacy controls, and a real Socratic coaching API.
