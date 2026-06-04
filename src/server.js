import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3001', 10);
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const MAX_RESULTS = parseInt(process.env.MAX_RESULTS || '24', 10);
const QUERY_CACHE_MINUTES = parseInt(process.env.QUERY_CACHE_MINUTES || '60', 10);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const STOREFRONT_URL = process.env.SHOPIFY_STOREFRONT_URL || `https://${SHOPIFY_DOMAIN.replace('.myshopify.com', '.com')}`;

if (!SHOPIFY_DOMAIN || !CLAUDE_KEY) {
  console.error('FALTA configuracion en .env: SHOPIFY_STORE_DOMAIN, ANTHROPIC_API_KEY');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: CLAUDE_KEY });

const queryCache = new Map();
function cacheKey(q) { return q.toLowerCase().trim(); }
function cacheGet(q) {
  const entry = queryCache.get(cacheKey(q));
  if (!entry) return null;
  if (Date.now() - entry.t > QUERY_CACHE_MINUTES * 60 * 1000) {
    queryCache.delete(cacheKey(q));
    return null;
  }
  return entry.v;
}
function cacheSet(q, v) {
  queryCache.set(cacheKey(q), { v, t: Date.now() });
}

let taxonomyCache = null;
async function loadTaxonomy() {
  if (taxonomyCache) return taxonomyCache;
  try {
    const taxPath = path.join(__dirname, '..', '..', 'data', 'protocolo-c-taxonomy.json');
    const content = await fs.readFile(taxPath, 'utf-8');
    taxonomyCache = JSON.parse(content);
  } catch {
    taxonomyCache = { departamentos: {} };
  }
  return taxonomyCache;
}

const QUERY_EXPANDER_SYSTEM = `Eres el motor de comprension de busqueda de ICI El Salvador, ferreteria online.
Recibis una busqueda del usuario y devolves keywords expandidos.

DICCIONARIO SV: destornillador=desarmador=atornillador; foco=bombilla; llave de chorro=grifo=chorro; pegamento=pega; cinta=wincha=flexometro; taladro=barreno; sierra=serrucho; tornillo (roscado)≠clavo (liso); tomacorriente=toma; enchufe=clavija; PVC=tuberia plastica; HG=hierro galvanizado.

Responde SOLO JSON sin markdown:
{
  "intent": "que busca",
  "is_project_query": false,
  "expanded_keywords": ["k1","k2","..."],
  "departments": ["..."],
  "categories": ["..."],
  "exclude": [],
  "explanation": "1 frase amigable max 15 palabras"
}`;

async function expandQuery(query, taxonomy) {
  const cached = cacheGet(query);
  if (cached) return { ...cached, fromCache: true };

  const userPrompt = `Departamentos disponibles: ${Object.keys(taxonomy.departamentos).join(', ')}

Busqueda: "${query}"

Expande. JSON solo.`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 500,
    system: QUERY_EXPANDER_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed;
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {
      intent: query,
      is_project_query: false,
      expanded_keywords: [query],
      departments: [],
      categories: [],
      exclude: [],
      explanation: ''
    };
  }

  cacheSet(query, parsed);
  return parsed;
}

async function shopifyStorefrontQuery(query, variables = {}) {
  const url = `https://${SHOPIFY_DOMAIN}/api/2025-01/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(STOREFRONT_TOKEN ? { 'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN } : {})
    },
    body: JSON.stringify({ query, variables })
  });

  if (!res.ok) {
    throw new Error(`Shopify Storefront ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  if (data.errors) throw new Error(`Shopify errors: ${JSON.stringify(data.errors)}`);
  return data.data;
}

const STOPWORDS = new Set(['con','los','las','del','que','para','por','una','uno','sus','esta','esto','este','como','más','pero','fue','ser','son','han','hay','les','nos','sin','muy','bien','así','era','sea','todo','toda','cada','según','cuando','donde','entre','mango','punta','juego','tipo','marca','buen','alto','bajo','gran','nuevo','bajo']);

function buildSearchQuery(expanded) {
  const wordSet = new Set();
  for (const kw of expanded.expanded_keywords.slice(0, 8)) {
    for (const word of kw.split(/\s+/)) {
      const w = word.toLowerCase();
      if (w.length > 3 && !STOPWORDS.has(w)) wordSet.add(w);
    }
  }
  const titleTerms = [...wordSet].slice(0, 10).map(w => `title:${w}`);
  return titleTerms.length ? titleTerms.join(' OR ') : (expanded.intent || 'all');
}

async function searchProducts(expanded) {
  const queryString = buildSearchQuery(expanded);

  const gql = `
    query searchProducts($q: String!, $first: Int!) {
      products(first: $first, query: $q) {
        edges {
          node {
            id
            handle
            title
            vendor
            productType
            tags
            description(truncateAt: 200)
            featuredImage { url altText }
            priceRange {
              minVariantPrice { amount currencyCode }
            }
            availableForSale
          }
        }
      }
    }
  `;

  const data = await shopifyStorefrontQuery(gql, { q: queryString, first: MAX_RESULTS });
  return data.products.edges.map(e => e.node);
}

function rankProducts(products, expanded, originalQuery) {
  const qLower = originalQuery.toLowerCase();
  const keywords = expanded.expanded_keywords.map(k => k.toLowerCase());
  const words = [...new Set(keywords.flatMap(k => k.split(/\s+/).filter(w => w.length > 2)))];
  const exclude = (expanded.exclude || []).map(k => k.toLowerCase());

  return products
    .map(p => {
      let score = 0;
      const title = (p.title || '').toLowerCase();
      const desc = (p.description || '').toLowerCase();
      const tags = (p.tags || []).map(t => t.toLowerCase());
      const ptype = (p.productType || '').toLowerCase();

      if (title.includes(qLower)) score += 50;

      for (const kw of keywords) {
        if (title.includes(kw)) score += 12;
        if (ptype.includes(kw)) score += 8;
        for (const tag of tags) {
          if (tag === `kw:${kw}` || tag === kw) score += 6;
          else if (tag.includes(kw)) score += 3;
        }
        if (desc.includes(kw)) score += 2;
      }

      let titleRelevance = 0;
      for (const w of words) {
        if (title.includes(w)) { score += 5; titleRelevance += 5; }
        if (ptype.includes(w)) { score += 3; titleRelevance += 3; }
        if (desc.includes(w)) score += 1;
      }

      for (const ex of exclude) {
        if (title.includes(ex) || desc.includes(ex)) score -= 30;
      }

      if (p.availableForSale) score += 5;

      return { ...p, _score: score, _relevance: titleRelevance };
    })
    .filter(p => p._relevance > 0)
    .sort((a, b) => b._score - a._score);
}

const app = express();
app.use(express.json());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS rechazado: ${origin}`));
  }
}));

app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.post('/api/search', async (req, res) => {
  const { query } = req.body || {};
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return res.status(400).json({ error: 'query es requerida (min 2 chars)' });
  }

  try {
    const taxonomy = await loadTaxonomy();
    const expanded = await expandQuery(query.trim(), taxonomy);
    const products = await searchProducts(expanded);
    const ranked = rankProducts(products, expanded, query);

    res.json({
      query,
      intent: expanded.intent,
      explanation: expanded.explanation,
      is_project_query: expanded.is_project_query,
      keywords_used: expanded.expanded_keywords,
      total_results: ranked.length,
      results: ranked.slice(0, MAX_RESULTS).map(p => ({
        id: p.id,
        handle: p.handle,
        title: p.title,
        vendor: p.vendor,
        type: p.productType,
        description: p.description,
        image: p.featuredImage?.url,
        image_alt: p.featuredImage?.altText,
        price: p.priceRange?.minVariantPrice?.amount,
        currency: p.priceRange?.minVariantPrice?.currencyCode,
        available: p.availableForSale,
        url: `${STOREFRONT_URL}/products/${p.handle}`,
        score: p._score
      }))
    });
  } catch (err) {
    console.error('Error en busqueda:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/suggest', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (q.length < 2) return res.json({ suggestions: [] });

  const suggestions = [
    `${q}`,
    `${q} truper`,
    `${q} barato`,
    `${q} profesional`
  ];
  res.json({ suggestions: suggestions.slice(0, 5) });
});

app.listen(PORT, () => {
  console.log(`\nMotor de busqueda ICI corriendo en http://localhost:${PORT}`);
  console.log(`  POST /api/search   { "query": "..." }`);
  console.log(`  GET  /api/suggest?q=...`);
  console.log(`  GET  /health\n`);
});
