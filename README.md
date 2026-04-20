# 🎬 TorrentBR Scraper — Addon para Stremio

Addon que raspa torrents em tempo real de **7 fontes diferentes** para filmes e séries.

## Fontes de Torrent

| Fonte | Tipo | Suporte |
|-------|------|---------|
| **YTS** | API JSON | 🎬 Filmes |
| **EZTV** | API JSON | 📺 Séries |
| **The Pirate Bay** | API JSON | 🎬🎬 Filmes e Séries |
| **RARBG (TorrentAPI)** | API JSON | 🎬📺 Filmes e Séries |
| **1337x** | HTML Scraping | 🎬📺 Filmes e Séries |
| **Kickass Torrents** | HTML Scraping | 🎬📺 Filmes e Séries |
| **Nyaa.si** | HTML Scraping | 🎌 Anime / Conteúdo Asiático |

## Pré-requisitos

- **Node.js** v14 ou superior
- **npm** v6 ou superior
- Stremio instalado no seu dispositivo

## Instalação

```bash
# 1. Clonar/baixar os arquivos
cd stremio-torrent-addon

# 2. Instalar dependências
npm install

# 3. Iniciar o servidor
npm start
```

O servidor subirá em `http://localhost:7000`.

## Como Instalar no Stremio

### Método 1 — Pelo Navegador
1. Acesse `http://localhost:7000`
2. Clique em **"Install"** na página do manifesto

### Método 2 — Manual
1. Abra o Stremio
2. Vá em **Addons** → **Community Addons**
3. Cole a URL: `http://localhost:7000/manifest.json`
4. Clique em **Install**

## Como Funciona

1. Quando você abre um filme/série no Stremio, o addon é chamado com o **IMDB ID**
2. O addon consulta o **OMDB** para resolver o título real
3. Todos os 7 scrapers rodam **em paralelo** simultaneamente
4. Os resultados são **desduplicados** por `infoHash`
5. Os streams são **ordenados** por qualidade (4K → 1080p → 720p) e depois por seeders

## Estrutura dos Arquivos

```
stremio-torrent-addon/
├── server.js      # Servidor Express + entrada
├── addon.js       # Definição do manifest e handler de streams
├── scrapers.js    # Todos os 7 scrapers (YTS, TPB, EZTV, etc.)
├── package.json
└── README.md
```

## Deploy em Produção (Opcional)

Para acessar de qualquer lugar (TV, celular), faça deploy em um servidor:

### Railway / Render / Heroku
```bash
# Defina a variável de ambiente PORT (geralmente feito automaticamente)
# O servidor usa process.env.PORT || 7000
```

### Docker (opcional)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 7000
CMD ["node", "server.js"]
```

## Personalização

Para adicionar mais scrapers, edite `scrapers.js` e adicione a função ao array `tasks` dentro de `scrapeAll()`.

## Aviso Legal

Este addon é para fins educacionais. Use apenas para conteúdo que você tem o direito legal de acessar.
