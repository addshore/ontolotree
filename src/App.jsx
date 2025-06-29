import React, { useEffect, useState, useRef } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import md5 from 'md5';
import './App.css';

// Helper: Generate SPARQL query for subclass tree
function generateSubclassTreeQuery(rootQid, maxDepth) {
  const unions = [];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const path = Array(depth).fill('wdt:P279').join('/');
    let parentPattern, valuePicPattern, parentPicPattern;
    if (depth === 1) {
      parentPattern = `BIND(wd:${rootQid} AS ?parent)`;
      valuePicPattern = 'OPTIONAL { ?value wdt:P18 ?valuePic. }';
      parentPicPattern = 'OPTIONAL { wd:' + rootQid + ' wdt:P18 ?parentPic. }';
    } else {
      parentPattern = `?parent wdt:P279 ?value .\n    FILTER EXISTS { wd:${rootQid} ${Array(depth-1).fill('wdt:P279').join('/')} ?parent }`;
      valuePicPattern = 'OPTIONAL { ?value wdt:P18 ?valuePic. }';
      parentPicPattern = 'OPTIONAL { ?parent wdt:P18 ?parentPic. }';
    }
    unions.push(`\n  {\n    wd:${rootQid} ${path} ?value .\n    BIND(${depth} AS ?depth)\n    ${parentPattern}\n    ${valuePicPattern}\n    ${parentPicPattern}\n  }`);
  }
  return `SELECT ?value ?valueLabel ?depth ?parent ?parentLabel ?valuePic ?parentPic WHERE {\n${unions.join('\n  UNION')}\n  SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],mul,en". }\n}\nORDER BY ?depth`;
}

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
    let valueImg = row.valuePic?.value;
    let parentImg = row.parentPic?.value;
    valueImg = commonsDirectUrl(valueImg);
    parentImg = commonsDirectUrl(parentImg);
    if (!nodes[qid]) {
      nodes[qid] = {
        data: {
          id: qid,
          label: qid + ": " + label,
          qid,
          img: valueImg
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
          img: parentImg
        }
      };
      if (parentQid === rootQid) rootLabel = parentLabel;
      console.log('Add parent node:', nodes[parentQid]);
    } else if (parentImg && !nodes[parentQid].data.img) {
      nodes[parentQid].data.img = parentImg;
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
  name: 'breadthfirst',
  directed: true,
  padding: 10,
  spacingFactor: 1.3,
  animate: false,
  roots: ['heterotroph'],
  orientation: 'vertical',
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
      img: '#'
    }
  }), [rootQid]);
  useEffect(() => {
    async function fetchData() {
      const query = generateSubclassTreeQuery(rootQid, maxDepth);
      const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query);
      const res = await fetch(url);
      const data = await res.json();
      // Merge rootNode with query results, avoiding duplicate nodes by id
      const queryElements = sparqlResultsToElements(data.results.bindings, rootQid);
      const allNodes = [rootNode, ...queryElements.filter(e => e.data && e.data.id !== rootQid)];
      const allEdges = queryElements.filter(e => e.data && e.data.source && e.data.target);
      setElements([...allNodes, ...allEdges]);
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
