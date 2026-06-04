# 🔍 ICI Smart Search — Motor de búsqueda inteligente

Motor de búsqueda con comprensión de **lenguaje natural** + **sinónimos salvadoreños** + **expansion de query con IA** para tu tienda Shopify.

**Qué hace que sea diferente al buscador nativo:**

| Búsqueda del cliente | Buscador nativo | Smart Search |
|---|---|---|
| "desarmador phillips" | 0 resultados (porque tu producto dice "destornillador") | ✅ Encuentra destornilladores phillips |
| "algo para colgar cuadro pesado" | 0 resultados | ✅ Anclajes + tornillos + tacos fischer |
| "chorro de jardín" | Variable | ✅ Llaves de jardín, mangueras, pistolas |
| "wincha 5 metros" | 0 resultados | ✅ Cintas métricas / flexómetros |

## 🏗 Arquitectura

```
Cliente (Dawn theme) 
       │
       │ POST { "query": "desarmador phillips" }
       ▼
   Tu backend Express (este proyecto)
       │
       ├─→ Claude API (expande query con sinónimos)
       │   Devuelve: ["destornillador phillips", "desarmador", "phillips", ...]
       │
       └─→ Shopify Storefront API (busca productos)
           Devuelve: productos relevantes ordenados por score
       │
       ▼
   Cliente ve resultados
```

## 🚀 Setup local (10 minutos)

### Paso 1: Crear Storefront API token en Shopify

Es **diferente** al Admin API token que ya tenés. Es público y solo lee.

1. Shopify Admin → **Settings** → **Apps and sales channels** → **Develop apps**
2. Elegí tu app "ICI Bulk Fix" (la misma que ya creaste)
3. Pestaña **Configuration** → **Configure Storefront API**
4. Activá estos scopes:
   - `unauthenticated_read_product_listings`
   - `unauthenticated_read_product_tags`
   - `unauthenticated_read_product_pickup_locations` (opcional)
5. **Save** → pestaña **API credentials** → arriba ves el **Storefront API access token**
6. Copialo.

### Paso 2: Instalar y configurar

```bash
cd search-engine
npm install
cp .env.example .env
```

Editá `.env`:

```bash
PORT=3001
ANTHROPIC_API_KEY=sk-ant-xxxxx           # la misma de antes
SHOPIFY_STORE_DOMAIN=icicentroamerica.myshopify.com
SHOPIFY_STOREFRONT_TOKEN=xxxxxxxxx       # el que copiaste recién
ALLOWED_ORIGINS=https://icielsalvador.com,https://icicentroamerica.myshopify.com
```

### Paso 3: Probar localmente

```bash
npm start
```

Deberías ver:
```
Motor de busqueda ICI corriendo en http://localhost:3001
```

Probá con curl:

```bash
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "desarmador phillips"}'
```

Deberías ver JSON con productos.

## 🌐 Deploy a producción (gratis)

El backend tiene que estar accesible desde internet (no localhost). Recomendado: **Railway** o **Render** (ambos gratis para empezar).

### Opción A: Railway (más fácil)

1. Andá a https://railway.app y creá cuenta con GitHub
2. **New Project** → **Deploy from GitHub repo**
3. Subí esta carpeta `search-engine` como repo a GitHub primero
4. Railway detecta automáticamente que es Node
5. En **Variables**, pegá las variables del `.env`
6. Click **Deploy**
7. Railway te da una URL tipo `https://ici-search-engine.up.railway.app`
8. Copia esa URL — la vas a usar abajo

### Opción B: Render

1. https://render.com → New Web Service → conectá repo
2. Build command: `npm install`
3. Start command: `npm start`
4. Environment variables: las del `.env`
5. Free tier funciona pero duerme tras 15 min de inactividad

## 🎨 Conectar al tema Dawn

### Paso 1: Subir los archivos

En Shopify Admin → **Online Store** → **Themes** → tu tema (Dawn) → **Actions** → **Edit code**:

| Archivo | Carpeta destino |
|---|---|
| `dawn-theme/ici-smart-search.liquid` | `snippets/` |
| `dawn-theme/ici-smart-search.css` | `assets/` |
| `dawn-theme/ici-smart-search.js` | `assets/` |

### Paso 2: Configurar la URL del API

Opción 1 (recomendada): Agregar a `config/settings_schema.json` un setting nuevo:

```json
{
  "name": "ICI Smart Search",
  "settings": [
    {
      "type": "url",
      "id": "ici_search_api_url",
      "label": "URL del API de búsqueda",
      "default": "https://ici-search-engine.up.railway.app"
    }
  ]
}
```

Después en **Theme settings** lo configurás visualmente.

Opción 2 (rápida): editar el snippet `ici-smart-search.liquid` línea 13 y reemplazar el default con tu URL.

### Paso 3: Insertar el buscador en el header

Editá `sections/header.liquid`. Buscá donde está el form `<form action="/search"...>` y reemplazalo por:

```liquid
{% render 'ici-smart-search' %}
```

O si querés tenerlo **en paralelo** al buscador nativo (para A/B testing), solo agregalo cerca:

```liquid
<!-- buscador nativo Dawn -->
{% render 'header-search', ... %}

<!-- nuevo buscador IA -->
{% render 'ici-smart-search' %}
```

### Paso 4: Guardar y probar

Guardá el tema → andá a tu tienda → vas a ver un botón "Buscar" → clic → se abre el modal → buscá "desarmador" y debería traerte destornilladores.

## 🧪 Endpoints disponibles

### POST `/api/search`

```bash
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "necesito algo para pintar mi cuarto"}'
```

Respuesta:
```json
{
  "query": "necesito algo para pintar mi cuarto",
  "intent": "productos para pintura de interior",
  "explanation": "Te muestro pinturas, brochas y accesorios.",
  "is_project_query": true,
  "keywords_used": ["pintura latex", "pintura interior", "brocha", "rodillo", ...],
  "total_results": 18,
  "results": [
    {
      "id": "gid://shopify/Product/123",
      "title": "Pintura látex blanca 1 galón",
      "vendor": "MegaColor",
      "price": "12.50",
      "currency": "USD",
      "url": "https://icielsalvador.com/products/...",
      "image": "https://...",
      "available": true,
      "score": 86
    }
  ]
}
```

### GET `/health`
Para verificar que el servicio está vivo. Útil para uptime monitors.

## 💰 Costos

- **Por búsqueda**: ~$0.0003 USD (Claude Haiku 4.5)
- **10,000 búsquedas**: ~$3 USD
- **Cache**: las queries idénticas en 60 min no vuelven a llamar a Claude (gratis)

## 🛠 Troubleshooting

**El widget no se abre**
→ Verificá la consola del browser. Si dice CORS, agregá tu dominio a `ALLOWED_ORIGINS` en el backend.

**El backend devuelve 401 de Shopify**
→ El Storefront token está mal o le faltan scopes. Revisá en Shopify Admin.

**Las búsquedas no encuentran productos relevantes**
→ Asegurate de haber corrido `npm run enrich` primero (los `kw:` tags son los que hacen funcionar la búsqueda fina).

**Claude devuelve JSON inválido**
→ El sistema cae en fallback automáticamente. Si pasa siempre, abrí un issue.

## 🔮 Próximas mejoras

- [ ] Análisis de imágenes (subí foto → encontrá productos)
- [ ] Recomendaciones cruzadas
- [ ] Histórico de búsquedas frecuentes para auto-tuning
- [ ] Embeddings vectoriales para búsqueda semántica pura
