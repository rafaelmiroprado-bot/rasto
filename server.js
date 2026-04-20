const { serveHTTP } = require("stremio-addon-sdk");
const addonInterface = require("./addon");

const PORT = process.env.PORT || 7000;

serveHTTP(addonInterface, { port: PORT });

console.log(`[Purefy] running on port ${PORT}`);
console.log(`[Purefy] manifest: http://127.0.0.1:${PORT}/manifest.json`);
