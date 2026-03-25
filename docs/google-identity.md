# Google Identity Integration

Google Identity Services (GIS) logic moved from inline dynamic script injection inside `AuthGate` to a dedicated module: `src/services/googleIdentity.ts`.

## Rationale
- Keeps `index.html` minimal (no direct `<script src="https://accounts.google.com/gsi/client">`).
- Centralizes loading / initialization / rendering and allows reuse elsewhere.
- Easier to adapt for lazy loading, error handling, retries, or One Tap prompts.

## Usage Flow
1. User clicks the Sign In button in `AuthGate`.
2. `startGoogle()` calls `initGoogleIdentity(clientId, callback)` from the service.
3. After initialization, `renderGoogleButton()` is called to place the GIS button in the container.
4. The callback receives `{ credential }` and passes it to parent via `onSignedIn`.

## Environment Variable
Ensure `VITE_GOOGLE_CLIENT_ID` is defined. On Netlify you can add this under Site Settings > Build & Deploy > Environment. Vite exposes it at build time as `import.meta.env.VITE_GOOGLE_CLIENT_ID`.

## Service API
```
loadGoogleIdentity(): Promise<google>
initGoogleIdentity(clientId, callback)
renderGoogleButton(target, options?)
promptOneTap()
```

## Runtime Fallback (config.json)
The app will now attempt to resolve the Google client ID in this order:
1. Build-time `import.meta.env.VITE_GOOGLE_CLIENT_ID`
2. `window.__AF_ENV.googleClientId` (if you inject an inline script)
3. `<meta name="google-client-id" content="..." />`
4. `GET /config.json` (runtime file placed in `public/`)

Edit `public/config.json` post-deploy to rotate the client id without rebuilding.

Example `config.json`:
```
{ "googleClientId": "123456789-xyz.apps.googleusercontent.com" }
```

If all sources fail, a small inline fallback message renders instead of a dead button.

## One Tap
To enable One Tap later you can call `promptOneTap()` after initialization if desired (ensure UX approval to avoid intrusive prompts).

## Error Handling
If loading fails, `AuthGate` enters `error` mode and offers a retry button.

## Future Enhancements
- Token refresh / expiry detection.
- Analytics hook on sign-in method (select_by).
- Support style variants (dark, filled) via options passed to `renderGoogleButton`.
- Optional SRI/integrity check for the GIS script.
