# Plezy Extensions Registry 🔌

Este es el repositorio oficial de extensiones para **Plezy**. Contiene proveedores de streaming online y buscadores de torrents modularizados, organizados y listos para ser consumidos directamente desde la app a través del marketplace.

---

## 📁 Estructura del Repositorio

El repositorio sigue un diseño modular y claro para permitir que cualquiera pueda agregar sus propias extensiones fácilmente:

```text
plezy-extensions/
├── extensions/
│   ├── online/                  # Proveedores de Streaming Online
│   │   └── es/                  # Idioma (ej. es, en, multi)
│   │       └── animeav1/        # ID de la extensión
│   │           ├── manifest.json# Metadatos de la extensión
│   │           └── animeav1.js  # Código de la extensión (Clase Provider)
│   │
│   └── torrent/                 # Proveedores de Torrents
│       └── multi/               # Multilingüe / Genérico
│           ├── animetosho/
│           │   ├── manifest.json
│           │   └── animetosho.js
│           └── nekobt/
│               ├── manifest.json
│               └── nekobt.js
│
├── index.json                   # Índice general autogenerado (Marketplace)
├── build.js                     # Script de validación y compilación
└── README.md
```

---

## 🛠️ Cómo agregar una nueva extensión

Para crear tu propia extensión personalizada, sigue estos pasos:

### 1. Crear la carpeta
Crea una carpeta dentro de `extensions/<type>/<language>/<your-extension-id>/`.
*   `<type>` puede ser: `online`, `torrent`, o `manga`.
*   `<language>` puede ser el código del idioma (`es`, `en`, `pt`, etc.) o `multi` si es global.
*   `<your-extension-id>` debe ser un identificador único en minúsculas y sin espacios.

### 2. Crear el `manifest.json`
El archivo de manifiesto define los metadatos que la app leerá. Estructura requerida:

```json
{
  "id": "mi-extension-id",
  "name": "Nombre De Mi Extension",
  "version": "1.0.0",
  "type": "online",
  "language": "es",
  "dub": false,
  "sub": true,
  "code": "mi-extension-id.js",
  "icon": "icon.png"
}
```

*   `code`: El nombre del archivo JavaScript principal dentro de tu carpeta.
*   `icon`: Puede ser una URL externa (`https://...`) o el nombre de un archivo de imagen local en tu carpeta (ej. `icon.png`). El script de build lo resolverá automáticamente a una URL de GitHub.

### 3. Crear el archivo JavaScript
Tu archivo JS debe exportar una clase global `Provider` con los métodos correspondientes. Por ejemplo:

```javascript
class Provider {
    constructor() {
        this.baseUrl = "https://misitio.com";
    }

    // Opcional para indicar capacidades
    getSettings() {
        return {
            episodeServers: ["MiServidor"],
            supportsDub: false,
        };
    }

    // Búsqueda general
    async search(query, isDub) {
        // Retorna un array con { title, slug, image, subOrDub } para online
        // O { title, link, seeders, leechers, downloads, hash, size, date } para torrents
    }

    // Resolutores específicos (online o torrent según corresponda)
    // Revisa las extensiones existentes para ver la implementación exacta.
}
```

---

## 🚀 Compilar el Índice (`index.json`)

Para validar todas las extensiones y generar el archivo de índice general `index.json` que consume Plezy, ejecuta:

```bash
node build.js
```

### ✨ Magia de Git
Si tu repositorio local tiene configurado un origin remoto de GitHub (por ejemplo, al ejecutar `git remote add origin https://github.com/tu-usuario/plezy-extensions.git`), el script `build.js` lo detectará de forma automática y:
1.  Resolverá los archivos `.js` a URLs absolutas directas de GitHub (`raw.githubusercontent.com`).
2.  Resolverá los iconos locales (`icon.png`) a URLs web absolutas de GitHub para que se muestren correctamente en la interfaz de Plezy.

---

## 🤖 Despliegue Automático con GitHub Actions

Para que no tengas que compilar el archivo `index.json` de forma manual cada vez que subas cambios, hemos configurado una acción de GitHub. 

Cada vez que hagas un `git push` a `main`, GitHub Actions:
1.  Correrá el script `build.js` para compilar el `index.json`.
2.  Subirá el archivo indexado de vuelta a tu repositorio de forma transparente.

La URL de tu Marketplace de extensiones será:
`https://raw.githubusercontent.com/<TU_USUARIO>/<TU_REPO>/main/index.json`

¡Ingresa esa URL en la configuración de extensiones de Plezy y listo!
