# Minecraft Console

The hosted Worker serves the console and accepts authenticated updates from
the desktop WSServer. Each server startup generates a random viewing code and
a separate publisher credential; publisher credentials never reach browsers.

Visitors enter only the viewing code. The site URL is configured in
plugins/webConsole.js in the desktop project. No local HTTP server, manual
backend URL or GitHub Pages deployment is required.

R2 holds one bounded JSON snapshot per hashed viewing code. Missing heartbeats
mark a server offline after 15 seconds; browser polling adds up to 3 seconds.
Codes stop working after 24 hours without updates. Expired objects are not
listed or exposed; object retention can be managed at the storage layer.

Run node scripts/test-api.mjs for API tests, node scripts/build-portable.mjs
to build, and node scripts/validate-artifact.mjs to validate the Worker.
