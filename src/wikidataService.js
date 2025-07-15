// Wikidata API and query helpers

/**
 * Fetch Wikidata REST API item JSON for a QID, with exponential backoff on 429.
 */
export async function fetchWikidataItemJson(qid, maxRetries = 5, baseDelay = 500) {
  const url = `https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/${qid}`;
  return fetchWithBackoff(async () => {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`Failed to fetch item JSON for ${qid}${res.status === 429 ? ' (429)' : ''}`);
    return await res.json();
  }, maxRetries, baseDelay);
}

/**
 * Fetch Wikidata REST API property JSON for a PID, with exponential backoff on 429.
 */
export async function fetchWikidataPropertyJson(pid, maxRetries = 5, baseDelay = 500) {
  const url = `https://www.wikidata.org/w/rest.php/wikibase/v1/entities/properties/${pid}`;
  return fetchWithBackoff(async () => {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`Failed to fetch property JSON for ${pid}${res.status === 429 ? ' (429)' : ''}`);
    return await res.json();
  }, maxRetries, baseDelay);
}

// Retry with exponential backoff for 429s
export async function fetchWithBackoff(fn, maxRetries = 5, baseDelay = 500) {
  let attempt = 0;
  while (true) {
    try {
      if (attempt > 0) {
        console.log(`Retrying (attempt ${attempt})...`);
      }
      return await fn();
    } catch (e) {
      if (e?.response?.status === 429 || e?.message?.includes('429')) {
        if (attempt >= maxRetries) {
          console.error(`Max retries reached (${maxRetries}). Giving up.`);
          throw e;
        }
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 100;
        console.warn(`Received 429. Waiting ${Math.round(delay)}ms before retrying (attempt ${attempt + 1})...`);
        await new Promise(res => setTimeout(res, delay));
        attempt++;
      } else {
        console.error('Fetch failed with error:', e);
        throw e;
      }
    }
  }
}

// Memoized fetch for Wikidata item JSON (avoid duplicate requests)
const itemJsonCache = new Map();
export async function fetchWikidataItemJsonMemo(qid) {
  if (itemJsonCache.has(qid)) return itemJsonCache.get(qid);
  const promise = fetchWikidataItemJson(qid);
  itemJsonCache.set(qid, promise);
  return promise;
}

// Memoized fetch for Wikidata property JSON (avoid duplicate requests)
const propertyJsonCache = new Map();
export async function fetchWikidataPropertyJsonMemo(pid) {
  if (propertyJsonCache.has(pid)) return propertyJsonCache.get(pid);
  const promise = fetchWikidataPropertyJson(pid);
  propertyJsonCache.set(pid, promise);
  return promise;
}

// Get label from Wikidata REST API item JSON
export function getLabelFromItemJson(itemJson, lang = 'en') {
  if (!itemJson || !itemJson.labels) return undefined;
  return (
    itemJson.labels[lang] ||
    itemJson.labels['en'] ||
    Object.values(itemJson.labels)[0]
  );
}

// Get label from property JSON
export function getLabelFromPropertyJson(propertyJson, lang = 'en') {
  if (!propertyJson || !propertyJson.labels) return undefined;
  return (
    propertyJson.labels[lang] ||
    propertyJson.labels['en'] ||
    Object.values(propertyJson.labels)[0]
  );
}

// Get P18 image filename from Wikidata REST API item JSON
export function getImageFilenameFromItemJson(itemJson) {
  if (!itemJson || !itemJson.statements) return undefined;
  const claims = itemJson.statements.P18;
  if (!claims || !Array.isArray(claims) || claims.length === 0) return undefined;
  return claims[0]?.value?.content;
}

// Generate SPARQL query for all ancestors (reverse P279 tree)
export function generateSimpleSuperclassQuery(rootQid) {
  return `SELECT DISTINCT ?i WHERE { ?i (wdt:P279/wdt:P279*) wd:${rootQid} }`;
}

// Generate simple SPARQL query for all descendants (P279 or P31)
export function generateSimpleSubclassOrInstanceQuery(rootQid) {
  return `SELECT DISTINCT ?i WHERE { wd:${rootQid} (wdt:P279)+ ?i }`;
}

// Generate upward queries
export function generateUpwardInstancesQuery(rootQid) {
  return `SELECT DISTINCT ?i WHERE { wd:${rootQid} wdt:P31 ?i }`;
}

export function generateUpwardP13359Query(rootQid) {
  return `SELECT DISTINCT ?i WHERE { wd:${rootQid} wdt:P31 ?i1 . ?i1 wdt:P13359 ?i }`;
}

export function generateUpwardP13359ChainQuery(rootQid) {
  return `SELECT DISTINCT ?i WHERE { wd:${rootQid} wdt:P31 ?i1 . ?i1 wdt:P13359 ?i2 . ?i2 (wdt:P31/wdt:P279|wdt:P279)+ ?i }`;
}

// Generate downward queries
export function generateDownwardInstancesQuery(rootQid) {
  return `SELECT DISTINCT ?i WHERE { ?i wdt:P31 wd:${rootQid} }`;
}

export function generateDownwardP13359Query(rootQid) {
  return `SELECT DISTINCT ?i WHERE { ?i (wdt:P31/wdt:P279* | wdt:P279/wdt:P279*) ?x . ?x wdt:P13359 wd:${rootQid} }`;
}