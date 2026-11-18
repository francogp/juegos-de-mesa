# 🎲 Ludoteca · Selector de Juegos de Mesa

Aplicación web estática, rápida e instalable (PWA) para elegir qué juego de mesa sacar a la mesa según la cantidad de jugadores, el tiempo disponible y la complejidad buscada, o explorar y gestionar toda la colección.

## ✨ Características

- **Sorteo inteligente sin repeticiones**: Selector rápido de jugadores (`1` a `7+`), filtros combinables de duración, complejidad y dinámica (competitivo / cooperativo), animación de barajado y botón **«Probar otro (descartar este)»** para no repetir opciones en la misma ronda.
- **32 juegos enriquecidos**: Incluye duración estimada, nivel de complejidad, modo de juego, etiquetas mecánicas, sinopsis en español y accesos directos a **BoardGameGeek (BGG)**, **Google Imágenes** y tutoriales en **YouTube**.
- **Explorador de colección y edición local**: Buscador instantáneo por título (español o inglés) y etiquetas, ordenamiento múltiple, y formulario para agregar o editar juegos (guardados localmente en `localStorage`) con opción de **Exportar / Importar `games.json`**.
- **Modo oscuro cálido y modo claro**: Estética inspirada en un club de juegos de mesa con cambio de tema persistente.
- **PWA Offline**: Incluye `manifest.webmanifest` y Service Worker (`sw.js`) para instalarla en el celular y usarla incluso sin conexión.

## 📁 Estructura del proyecto

```text
├── .github/workflows/deploy-pages.yml  # Despliegue automático en GitHub Pages
├── .nojekyll                           # Desactiva Jekyll para servir activos directos
├── index.html                          # Interfaz principal semántica y accesible
├── manifest.webmanifest                # Manifiesto de instalación PWA
├── sw.js                               # Service Worker para soporte sin conexión
├── css/styles.css                      # Sistema de diseño en Vanilla CSS
├── data/games.json                     # Base de datos editable de la colección
├── js/
│   ├── default-games.js                # Respaldo sincronizado para uso local (file://)
│   ├── storage.js                      # Carga de JSON, localStorage e import/export
│   └── app.js                          # Lógica de sorteo, filtros, catálogo y PWA
└── assets/                             # Iconos PWA, favicon SVG e imagen OpenGraph
```

## 🚀 Publicación en GitHub Pages

El proyecto incluye el workflow oficial `.github/workflows/deploy-pages.yml`:

1. En GitHub, abre **Settings → Pages** dentro del repositorio `francogp/juegos-de-mesa`.
2. En **Build and deployment → Source**, selecciona **GitHub Actions** (o bien **Deploy from a branch** → rama `main` / carpeta `/ (root)`, ya que no requiere compilación).
3. Al fusionar en `main`, la web quedará publicada automáticamente en:
   `https://francogp.github.io/juegos-de-mesa/`

## 🛠️ Desarrollo local y actualización permanente de juegos

Para probar localmente:

```bash
python3 -m http.server 8080
```

Para actualizar la colección pública de forma permanente:
1. Agrega o edita los juegos desde la propia web y pulsa **Exportar JSON** en la pestaña **Colección**.
2. Reemplaza `data/games.json` con el archivo descargado y haz commit al repositorio.
