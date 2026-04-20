const express = require("express");
const cors    = require("cors");
const path    = require("path");

const addonInterface = require("./addon");
const { getRouter }  = require("stremio-addon-sdk");

const app = express();

app.use(cors());

// Página de instalação
app.use(express.static(path.join(__dirname, "public")));

// Rotas do addon Stremio (manifest.json, stream handler, etc.)
app.use(getRouter(addonInterface));

// Fallback — redireciona qualquer rota desconhecida para a página inicial
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 7000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Anzol rodando em http://0.0.0.0:${PORT}`);
  console.log(`Manifest: http://0.0.0.0:${PORT}/manifest.json`);
});
