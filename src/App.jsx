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
    console.log('getCommonsFilename (Special:FilePath):', filename);
    return filename;
  }
  match = url.match(/File:(.+)$/);
  if (match) {
    const filename = decodeURIComponent(match[1]).replace(/ /g, '_');
    console.log('getCommonsFilename (File:):', filename);
    return filename;
  }
  console.log('getCommonsFilename: null');
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

// Helper: Generate SPARQL query for subclass tree (without images)
function generateSubclassTreeQueryNoImages(rootQid, maxDepth) {
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
  return `SELECT ?value ?valueLabel ?depth ?parent ?parentLabel WHERE {\n${unions.join('\n  UNION')}\n  SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],mul,en". }\n}\nORDER BY ?depth`;
}

function sparqlResultsToElements(results, rootQid = 'Q144') {
  const nodes = {};
  const edgeSet = new Set();
  const edges = [];
  let rootLabel = rootQid;
  results.forEach(row => {
    const qid = getQidFromUri(row.value.value);
    const parentQid = getQidFromUri(row.parent.value);
    const label = row.valueLabel?.value || qid;
    const parentLabel = row.parentLabel?.value || parentQid;
    const valueItemJson = row.valueItemJson;
    const parentItemJson = row.parentItemJson;
    const valueImg = getImageFilenameFromItemJson(valueItemJson);
    const parentImg = getImageFilenameFromItemJson(parentItemJson);
    if (!nodes[qid]) {
      nodes[qid] = {
        data: {
          id: qid,
          label: qid + ": " + label,
          qid,
          img: valueImg ? commonsDirectUrl('File:' + valueImg) : undefined,
          itemJson: valueItemJson
        }
      };
      if (qid === rootQid) rootLabel = label;
      console.log('Add node:', nodes[qid]);
    }
    if (!nodes[parentQid]) {
      nodes[parentQid] = {
        data: {
          id: parentQid,
          label: parentQid + ": " + parentLabel,
          qid: parentQid,
          img: parentImg ? commonsDirectUrl('File:' + parentImg) : undefined,
          itemJson: parentItemJson
        }
      };
      if (parentQid === rootQid) rootLabel = parentLabel;
      console.log('Add parent node:', nodes[parentQid]);
    } else if (parentImg && !nodes[parentQid].data.img) {
      nodes[parentQid].data.img = commonsDirectUrl('File:' + parentImg);
    }
    const edgeKey = `${parentQid}->${qid}`;
    if (!edgeSet.has(edgeKey)) {
      const edge = { data: { source: parentQid, target: qid } };
      edges.push(edge);
      edgeSet.add(edgeKey);
      console.log('Add edge:', edge);
    }
  });
  if (!nodes[rootQid]) {
    nodes[rootQid] = {
      data: {
        id: rootQid,
        label: rootLabel,
        qid: rootQid,
        img: undefined
      }
    };
    console.log('Add explicit root node:', nodes[rootQid]);
  }
  console.log('Final nodes:', Object.values(nodes));
  console.log('Final edges:', edges);
  return [...Object.values(nodes), ...edges];
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
      'border-color': ele => ele.data('id') === 'dog' ? '#ff6600' : '#888',
      'shape': 'ellipse',
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
  const maxDepth = 5;
  // Always include Q144 as a node
  const rootNode = React.useMemo(() => ({
    data: {
      id: rootQid,
      label: rootQid + ': Dog', // TODO: look up from API if needed
      qid: rootQid,
      // img: '#' // will be filled in after REST fetch
    }
  }), [rootQid]);
  useEffect(() => {
    async function fetchData() {
      // 1. Get subclass tree (no images) from SPARQL
      const query = generateSubclassTreeQueryNoImages(rootQid, maxDepth);
      const res = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: {
          'Accept': 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ query }),
      });
      const data = await res.json();
      // 2. Collect all QIDs (value and parent)
      const qids = new Set();
      data.results.bindings.forEach(row => {
        if (row.value?.value) qids.add(getQidFromUri(row.value.value));
        if (row.parent?.value) qids.add(getQidFromUri(row.parent.value));
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
      // 4. Build nodes and edges, adding itemJson to each node
      const nodes = {};
      const edgeSet = new Set();
      const edges = [];
      let rootLabel = rootQid;
      data.results.bindings.forEach(row => {
        const qid = getQidFromUri(row.value.value);
        const parentQid = getQidFromUri(row.parent.value);
        const label = row.valueLabel?.value || qid;
        const parentLabel = row.parentLabel?.value || parentQid;
        const valueItemJson = qidToItemJson[qid];
        const parentItemJson = qidToItemJson[parentQid];
        const valueImg = getImageFilenameFromItemJson(valueItemJson);
        const parentImg = getImageFilenameFromItemJson(parentItemJson);
        if (!nodes[qid]) {
          nodes[qid] = {
            data: {
              id: qid,
              label: qid + ": " + label,
              qid,
              img: valueImg ? commonsDirectUrl('File:' + valueImg) : undefined,
              itemJson: valueItemJson
            }
          };
          if (qid === rootQid) rootLabel = label;
        }
        if (!nodes[parentQid]) {
          nodes[parentQid] = {
            data: {
              id: parentQid,
              label: parentQid + ": " + parentLabel,
              qid: parentQid,
              img: parentImg ? commonsDirectUrl('File:' + parentImg) : undefined,
              itemJson: parentItemJson
            }
          };
          if (parentQid === rootQid) rootLabel = parentLabel;
        } else if (parentImg && !nodes[parentQid].data.img) {
          nodes[parentQid].data.img = commonsDirectUrl('File:' + parentImg);
        }
        const edgeKey = `${parentQid}->${qid}`;
        if (!edgeSet.has(edgeKey)) {
          const edge = { data: { source: parentQid, target: qid } };
          edges.push(edge);
          edgeSet.add(edgeKey);
        }
      });
      if (!nodes[rootQid]) {
        const rootItemJson = qidToItemJson[rootQid];
        const rootImg = getImageFilenameFromItemJson(rootItemJson);
        nodes[rootQid] = {
          data: {
            id: rootQid,
            label: rootLabel,
            qid: rootQid,
            img: rootImg ? commonsDirectUrl('File:' + rootImg) : undefined,
            itemJson: rootItemJson
          }
        };
      }
      const allNodes = Object.values(nodes);
      setElements([...allNodes, ...edges]);
      setLayoutKey(prev => prev + 1);
    }
    fetchData();
  }, [rootQid, maxDepth, rootNode]);
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
