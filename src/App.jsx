import React, { useEffect, useState, useRef } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import md5 from 'md5';
import pLimit from 'p-limit';
import './App.css';

// Helper: Extract QID from Wikidata URI
function getQidFromUri(uri) {
  const match = uri.match(/Q\d+$/);
  return match ? match[0] : uri;
}

function getCommonsFilename(url) {
  // Handles both .../Special:FilePath/ and .../File:...
  // Replace space with _ so the hashes are done right
  if (!url) return null;
  let match = url.match(/Special:FilePath\/(.+)$/);
  if (match) {
    const filename = decodeURIComponent(match[1]).replace(/ /g, '_');
    return filename;
  }
  match = url.match(/File:(.+)$/);
  if (match) {
    const filename = decodeURIComponent(match[1]).replace(/ /g, '_');
    return filename;
  }
  return null;
}

function commonsDirectUrl(url) {
  const filename = getCommonsFilename(url);
  if (!filename) return undefined;
  const hash = md5(filename);
  const first = hash[0];
  const first2 = hash.slice(0, 2);
  return `https://upload.wikimedia.org/wikipedia/commons/${first}/${first2}/${encodeURIComponent(filename)}`;
}

// Helper: Fetch Wikidata REST API item JSON for a QID
async function fetchWikidataItemJson(qid) {
  const url = `https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/${qid}`;
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Failed to fetch item JSON for ${qid}`);
  return await res.json();
}

// Helper: Get P18 image filename from Wikidata REST API item JSON
function getImageFilenameFromItemJson(itemJson) {
  const claims = itemJson.statements?.P18;
  if (!claims || !Array.isArray(claims) || claims.length === 0) return undefined;
  // P18 is a string value in the value field
  return claims[0]?.value.content;
}

// Helper: Get label from Wikidata REST API item JSON
function getLabelFromItemJson(itemJson, lang = 'en') {
  if (!itemJson || !itemJson.labels) return undefined;
  return (
    itemJson.labels[lang] ||
    itemJson.labels['en'] ||
    Object.values(itemJson.labels)[0]
  );
}

// Helper: Generate SPARQL query for all ancestors (reverse P279 tree)
function generateSimpleSuperclassQuery(rootQid) {
  return `SELECT DISTINCT ?i WHERE { ?i (wdt:P279/wdt:P279*) wd:${rootQid} }`;
}

const layout = {
  name: 'breadthfirst', // See https://js.cytoscape.org/#layouts/breadthfirst

  fit: true, // whether to fit the viewport to the graph
  directed: true, // whether the tree is directed downwards (or edges can point in any direction if false)
  padding: 30, // padding on fit
  circle: false, // put depths in concentric circles if true, put depths top down if false
  grid: true, // whether to create an even grid into which the DAG is placed (circle:false only)
  spacingFactor: 1.75, // positive spacing factor, larger => more space between nodes (N.B. n/a if causes overlap)
  boundingBox: undefined, // constrain layout bounds; { x1, y1, x2, y2 } or { x1, y1, w, h }
  avoidOverlap: true, // prevents node overlap, may overflow boundingBox if not enough space
  nodeDimensionsIncludeLabels: false, // Excludes the label when calculating node bounding boxes for the layout algorithm
  roots: undefined, // the roots of the trees
  depthSort: undefined, // a sorting function to order nodes at equal depth. e.g. function(a, b){ return a.data('weight') - b.data('weight') }
  animate: false, // whether to transition the node positions
  animationDuration: 500, // duration of animation in ms if enabled
  animationEasing: undefined, // easing of animation if enabled,
  animateFilter: function ( node, i ){ return true; }, // a function that determines whether the node should be animated.  All nodes animated by default on animate enabled.  Non-animated nodes are positioned immediately when the layout starts
  ready: undefined, // callback on layoutready
  stop: undefined, // callback on layoutstop
  transform: function (node, position ){ return position; } // transform a given node position. Useful for changing flow direction in discrete layouts0
};
const stylesheet = [
  {
    selector: 'node[img]',
    style: {
      'background-fit': 'cover',
      'background-image': 'data(img)',
    }
  },
  {
    selector: 'node',
    style: {
      'background-color': '#fff',
      'label': 'data(label)',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 10,
      'color': '#111',
      'font-size': 18,
      'font-weight': 'normal',
      'width': 80,
      'height': 80,
      'border-width': 6,
      'border-color': '#888',
      'shape': 'ellipse',
    }
  },
  {
    selector: 'node[type = "root"]',
    style: {
      'border-color': 'green',
      'border-width': 8
    }
  },
  {
    selector: 'node:selected',
    style: {
      'border-color': '#0074D9',
      'border-width': 8
    }
  },
  {
    selector: 'edge',
    style: {
      'width': 4,
      'line-color': '#bbb',
      'target-arrow-color': '#bbb',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'label': 'data(propertyLabel)',
      'font-size': 14,
      'color': '#333',
      'text-background-color': '#fff',
      'text-background-opacity': 1,
      'text-background-padding': 2,
      'text-rotation': 'autorotate',
    }
  },
  {
    selector: 'edge[property = "P279"]',
    style: {
      'line-color': '#7ecbff',
      'target-arrow-color': '#7ecbff',
    }
  },
];

// Helper: Fetch Wikidata REST API property JSON for a PID
async function fetchWikidataPropertyJson(pid) {
  const url = `https://www.wikidata.org/w/rest.php/wikibase/v1/entities/properties/${pid}`;
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Failed to fetch property JSON for ${pid}`);
  return await res.json();
}

// Helper: Get label from property JSON
function getLabelFromPropertyJson(propertyJson, lang = 'en') {
  if (!propertyJson || !propertyJson.labels) return undefined;
  return (
    propertyJson.labels[lang] ||
    propertyJson.labels['en'] ||
    Object.values(propertyJson.labels)[0]
  );
}

// Helper: Generate simple SPARQL query for all descendants (P279 or P31)
function generateSimpleSubclassOrInstanceQuery(rootQid) {
  return `SELECT DISTINCT ?i WHERE { wd:${rootQid} (wdt:P279)+ ?i }`;
}

// Helper: Retry with exponential backoff for 429s
async function fetchWithBackoff(fn, maxRetries = 5, baseDelay = 500) {
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

// Helper: Memoized fetch for Wikidata item JSON (avoid duplicate requests)
const itemJsonCache = new Map();
async function fetchWikidataItemJsonMemo(qid) {
  if (itemJsonCache.has(qid)) return itemJsonCache.get(qid);
  const promise = fetchWikidataItemJson(qid);
  itemJsonCache.set(qid, promise);
  return promise;
}

// Helper: Memoized fetch for Wikidata property JSON (avoid duplicate requests)
const propertyJsonCache = new Map();
async function fetchWikidataPropertyJsonMemo(pid) {
  if (propertyJsonCache.has(pid)) return propertyJsonCache.get(pid);
  const promise = fetchWikidataPropertyJson(pid);
  propertyJsonCache.set(pid, promise);
  return promise;
}

function App() {
  const [elements, setElements] = useState([]);
  const [layoutKey, setLayoutKey] = useState(0); // force layout refresh
  const [rootQid, setRootQid] = useState('Q144'); // root QID, default Q144
  const [inputQid, setInputQid] = useState('Q144'); // for the input box

  useEffect(() => {
    async function fetchData() {
      // 1. Get all descendants (P279/P31) and all ancestors (reverse P279)
      const descendantQuery = generateSimpleSubclassOrInstanceQuery(rootQid);
      const ancestorQuery = generateSimpleSuperclassQuery(rootQid);
      // Fetch descendants
      const resDesc = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: {
          'Accept': 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ query: descendantQuery }),
        cache: 'force-cache',
      });
      const dataDesc = await resDesc.json();
      // Fetch ancestors
      const resAnc = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: {
          'Accept': 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ query: ancestorQuery }),
        cache: 'force-cache',
      });
      const dataAnc = await resAnc.json();
      // 2. Collect all QIDs (descendants, ancestors, root)
      const qids = new Set();
      dataDesc.results.bindings.forEach(row => {
        if (row.i?.value) qids.add(getQidFromUri(row.i.value));
      });
      dataAnc.results.bindings.forEach(row => {
        if (row.i?.value) qids.add(getQidFromUri(row.i.value));
      });
      qids.add(rootQid);
      // Remove everything from Qids that isnt Q\d+
      const qidRegex = /^Q\d+$/;
      qids.forEach(qid => {
        if (!qidRegex.test(qid)) {
          console.warn(`Skipping invalid QID: ${qid}`);
          qids.delete(qid);
        }
      });
      // 3. Fetch all item JSONs in parallel, with concurrency and 429 handling, and memoization
      const limit = pLimit(4);
      const qidToItemJson = {};
      await Promise.all(Array.from(qids).map(qid =>
        limit(() => fetchWithBackoff(() => fetchWikidataItemJsonMemo(qid)))
          .then(json => { qidToItemJson[qid] = json; })
          .catch(e => { console.warn('Failed to fetch item JSON for', qid, e); })
      ));
      // 4. Build nodes and edges using P279 and P31 claims from JSON
      const nodes = {};
      const edgeSet = new Set();
      const edges = [];
      const propertyIds = new Set();
      // Add all nodes
      for (const qid of qids) {
        const itemJson = qidToItemJson[qid];
        const label = getLabelFromItemJson(itemJson) || qid;
        const img = getImageFilenameFromItemJson(itemJson);
        nodes[qid] = {
          data: {
            id: qid,
            label: qid + ': ' + label,
            img: img ? commonsDirectUrl('File:' + img) : undefined,
            itemJson,
            type: qid === rootQid ? 'root' : undefined
          }
        };
      }
      // Add edges based on P279 and P31 claims (and collect property ids)
      for (const qid of qids) {
        const itemJson = qidToItemJson[qid];
        // P279 edges
        const p279s = itemJson?.statements?.P279 || [];
        for (const claim of p279s) {
          const parentQid = claim.value?.content;
          if (parentQid && qids.has(parentQid)) {
            const pid = 'P279';
            propertyIds.add(pid);
            const edgeKey = `${parentQid}->${qid}->${pid}`;
            if (!edgeSet.has(edgeKey)) {
              edges.push({ data: { source: parentQid, target: qid, property: pid } });
              edgeSet.add(edgeKey);
            }
          }
        }
        // P31 edges
        const p31s = itemJson?.statements?.P31 || [];
        for (const claim of p31s) {
          const parentQid = claim.value?.content;
          if (parentQid && qids.has(parentQid)) {
            const pid = 'P31';
            propertyIds.add(pid);
            const edgeKey = `${parentQid}->${qid}->${pid}`;
            if (!edgeSet.has(edgeKey)) {
              edges.push({ data: { source: parentQid, target: qid, property: pid } });
              edgeSet.add(edgeKey);
            }
          }
        }
      }
      // Fetch property labels with concurrency, 429 handling, and memoization
      const pidToLabel = {};
      await Promise.all(Array.from(propertyIds).map(pid =>
        limit(() => fetchWithBackoff(() => fetchWikidataPropertyJsonMemo(pid)))
          .then(propertyJson => { pidToLabel[pid] = getLabelFromPropertyJson(propertyJson) || pid; })
          .catch(e => { console.warn('Failed to fetch property JSON for', pid, e); pidToLabel[pid] = pid; })
      ));
      // Add property label to edge data
      edges.forEach(edge => {
        edge.data.propertyLabel = pidToLabel[edge.data.property] || edge.data.property;
      });
      setElements([...Object.values(nodes), ...edges]);
      setLayoutKey(prev => prev + 1);
    }
    fetchData();
  }, [rootQid]);

  // Handler for input box
  function handleInputChange(e) {
    setInputQid(e.target.value);
  }
  function handleInputKeyDown(e) {
    if (e.key === 'Enter') {
      const trimmed = inputQid.trim();
      if (/^Q\\d+$/.test(trimmed)) {
        setRootQid(trimmed);
      }
    }
  }

  return (
    <div className="App" style={{ width: '100vw', height: '100vh', margin: 0, padding: 0, background: '#fafafa', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px 8px 16px', background: '#f0f0f0', borderBottom: '1px solid #ddd', display: 'flex', alignItems: 'center', zIndex: 2 }}>
        <label htmlFor="qid-input" style={{ fontWeight: 'bold', marginRight: 8 }}>Root QID:</label>
        <input
          id="qid-input"
          type="text"
          value={inputQid}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          style={{ fontSize: 18, padding: '4px 8px', borderRadius: 4, border: '1px solid #bbb', width: 120 }}
          placeholder="Q144"
        />
        <span style={{ marginLeft: 12, color: '#888', fontSize: 14 }}>Press Enter to update</span>
        <span style={{ marginLeft: 'auto', color: '#333', fontSize: 15, fontWeight: 500 }}>
          Nodes: {elements.filter(el => el.data && el.data.id).length} | Edges: {elements.filter(el => el.data && el.data.source && el.data.target).length}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <CytoscapeComponent
          key={layoutKey}
          elements={elements}
          layout={layout}
          stylesheet={stylesheet}
          style={{ width: '100vw', height: '100%', background: '#fafafa' }}
        />
      </div>
    </div>
  );
}

export default App;
