import React, { useEffect, useState, useRef } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import md5 from 'md5';
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
  const res = await fetch(url);
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

// Helper: Generate SPARQL query for subclass tree (no images, no label service)
function generateSubclassTreeQueryNoLabels(rootQid, maxDepth) {
  const unions = [];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const path = Array(depth).fill('wdt:P279').join('/');
    let parentPattern;
    if (depth === 1) {
      parentPattern = `BIND(wd:${rootQid} AS ?parent)`;
    } else {
      parentPattern = `?parent wdt:P279 ?value .\n    FILTER EXISTS { wd:${rootQid} ${Array(depth-1).fill('wdt:P279').join('/')} ?parent }`;
    }
    unions.push(`\n  {\n    wd:${rootQid} ${path} ?value .\n    BIND(${depth} AS ?depth)\n    ${parentPattern}\n  }`);
  }
  return `SELECT ?value ?depth ?parent WHERE {\n${unions.join('\n  UNION')}\n}`;
}

// Helper: Generate simple SPARQL query for all descendants
function generateSimpleSubclassQuery(rootQid) {
  return `SELECT DISTINCT ?i WHERE { wd:${rootQid} (wdt:P279)+ ?i }`;
}

const layout = {
  name: 'breadthfirst', // See https://js.cytoscape.org/#layouts/breadthfirst

  fit: true, // whether to fit the viewport to the graph
  directed: false, // whether the tree is directed downwards (or edges can point in any direction if false)
  padding: 30, // padding on fit
  circle: false, // put depths in concentric circles if true, put depths top down if false
  grid: false, // whether to create an even grid into which the DAG is placed (circle:false only)
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
    }
  }
];

function App() {
  const [elements, setElements] = useState([]);
  const [layoutKey, setLayoutKey] = useState(0); // force layout refresh
  // Change these to try different queries
  const rootQid = 'Q144'; // dog
  const maxDepth = 7;
  useEffect(() => {
    async function fetchData() {
      // 1. Get all descendants (no parent info) from SPARQL
      const query = generateSimpleSubclassQuery(rootQid);
      const res = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: {
          'Accept': 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ query }),
      });
      const data = await res.json();
      // 2. Collect all QIDs (descendants + root)
      const qids = new Set();
      data.results.bindings.forEach(row => {
        if (row.i?.value) qids.add(getQidFromUri(row.i.value));
      });
      qids.add(rootQid);
      // 3. Fetch all item JSONs in parallel
      const qidToItemJson = {};
      await Promise.all(Array.from(qids).map(async qid => {
        try {
          qidToItemJson[qid] = await fetchWikidataItemJson(qid);
        } catch (e) {
          console.warn('Failed to fetch item JSON for', qid, e);
        }
      }));
      // 4. Build nodes and edges using P279 claims from JSON
      const nodes = {};
      const edgeSet = new Set();
      const edges = [];
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
      // Add edges based on P279 claims
      for (const qid of qids) {
        const itemJson = qidToItemJson[qid];
        const p279s = itemJson?.statements?.P279 || [];
        for (const claim of p279s) {
          const parentQid = claim.value?.content;
          if (parentQid && qids.has(parentQid)) {
            const edgeKey = `${parentQid}->${qid}`;
            if (!edgeSet.has(edgeKey)) {
              edges.push({ data: { source: parentQid, target: qid } });
              edgeSet.add(edgeKey);
            }
          }
        }
      }
      setElements([...Object.values(nodes), ...edges]);
      setLayoutKey(prev => prev + 1);
    }
    fetchData();
  }, [rootQid, maxDepth]);
  return (
    <div className="App" style={{ width: '100vw', height: '100vh', margin: 0, padding: 0, background: '#fafafa' }}>
      <CytoscapeComponent
        key={layoutKey}
        elements={elements}
        layout={layout}
        stylesheet={stylesheet}
        style={{ width: '100vw', height: '100vh', background: '#fafafa' }}
      />
    </div>
  );
}

export default App;
