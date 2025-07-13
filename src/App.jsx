import React, { useEffect, useState, useRef } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import md5 from 'md5';
import pLimit from 'p-limit';
import './App.css';
import {
  fetchWithBackoff,
  fetchWikidataItemJsonMemo,
  fetchWikidataPropertyJsonMemo,
  getLabelFromItemJson,
  getLabelFromPropertyJson,
  getImageFilenameFromItemJson,
  generateSimpleSuperclassQuery,
  generateSimpleSubclassOrInstanceQuery
} from './wikidataService';

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
const getStylesheet = (showImages, nodeSize) => [
  {
    selector: 'node[img]',
    style: {
      'background-fit': 'cover',
      'background-image': showImages ? 'data(img)' : 'none',
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
      'font-size': 14,
      'font-weight': 'normal',
      'width': nodeSize,
      'height': nodeSize,
      'border-width': 6,
      'border-color': '#888',
      'shape': 'ellipse',
      'text-wrap': 'wrap',
      'text-max-width': '90px'
    }
  },
  {
    selector: 'node[type = "root"]',
    style: {
      'border-color': '#00ff00',
      'border-width': 12,
      'border-style': 'double',
      'background-color': '#e8f5e8',
      'font-weight': 'bold',
      'color': '#006600'
    }
  },
  {
    selector: 'node[type = "highlight"]',
    style: {
      'border-color': '#00ff00',
      'border-width': 12,
      'border-style': 'double',
      'background-color': '#e8f5e8',
      'font-weight': 'bold',
      'color': '#006600'
    }
  },
  {
    selector: 'node[sampledLevel]',
    style: {
      'border-color': '#ccc'
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


function App() {
  const [elements, setElements] = useState([]);
  const [layoutKey, setLayoutKey] = useState(0); // force layout refresh
  const [rootQids, setRootQids] = useState(() => localStorage.getItem('ontolotree-rootQids') || 'Q144');
  const [inputQids, setInputQids] = useState(() => localStorage.getItem('ontolotree-rootQids') || 'Q144');
  const [highlightQids, setHighlightQids] = useState(() => localStorage.getItem('ontolotree-highlightQids') || '');
  const [inputHighlightQids, setInputHighlightQids] = useState(() => localStorage.getItem('ontolotree-highlightQids') || '');
  const [showImages, setShowImages] = useState(() => localStorage.getItem('ontolotree-showImages') !== 'false');
  const [nodeSize, setNodeSize] = useState(() => Number(localStorage.getItem('ontolotree-nodeSize')) || 100);
  // Pending values for inputs
  const [sampleRate, setSampleRate] = useState(() => Number(localStorage.getItem('ontolotree-sampleRate')) || 100);
  const [sampleCount, setSampleCount] = useState(() => Number(localStorage.getItem('ontolotree-sampleCount')) || 10);
  // Applied values for graph
  const [appliedSampleRate, setAppliedSampleRate] = useState(() => Number(localStorage.getItem('ontolotree-sampleRate')) || 100);
  const [appliedSampleCount, setAppliedSampleCount] = useState(() => Number(localStorage.getItem('ontolotree-sampleCount')) || 10);
  const [totalNodeCount, setTotalNodeCount] = useState(0);
  const [totalEdgeCount, setTotalEdgeCount] = useState(0);
  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState(null);
  const [allItems, setAllItems] = useState([]);
  const cyRef = useRef(null);

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem('ontolotree-rootQids', rootQids);
  }, [rootQids]);

  useEffect(() => {
    localStorage.setItem('ontolotree-highlightQids', highlightQids);
  }, [highlightQids]);

  useEffect(() => {
    localStorage.setItem('ontolotree-sampleRate', sampleRate.toString());
  }, [sampleRate]);

  useEffect(() => {
    localStorage.setItem('ontolotree-sampleCount', sampleCount.toString());
  }, [sampleCount]);

  useEffect(() => {
    localStorage.setItem('ontolotree-showImages', showImages.toString());
  }, [showImages]);

  useEffect(() => {
    localStorage.setItem('ontolotree-nodeSize', nodeSize.toString());
  }, [nodeSize]);

  // Trigger initial redraw if applied settings don't match localStorage
  useEffect(() => {
    const storedSampleRate = Number(localStorage.getItem('ontolotree-sampleRate')) || 100;
    const storedSampleCount = Number(localStorage.getItem('ontolotree-sampleCount')) || 10;
    if (appliedSampleRate !== storedSampleRate || appliedSampleCount !== storedSampleCount) {
      setAppliedSampleRate(storedSampleRate);
      setAppliedSampleCount(storedSampleCount);
    }
  }, []);

  // Redraw graph when rootQids or applied sample settings change
  useEffect(() => {
    async function fetchData() {
      // Parse comma-separated QIDs
      const rootQidList = rootQids.split(',').map(qid => qid.trim()).filter(qid => /^Q\d+$/.test(qid));
      const highlightQidList = highlightQids.split(',').map(qid => qid.trim()).filter(qid => /^Q\d+$/.test(qid));
      if (rootQidList.length === 0) return;
      
      // 1. Get all descendants (P279/P31) and all ancestors (reverse P279) for all root QIDs
      const qids = new Set();
      
      for (const rootQid of rootQidList) {
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
        
        // Collect QIDs from this root
        dataDesc.results.bindings.forEach(row => {
          if (row.i?.value) qids.add(getQidFromUri(row.i.value));
        });
        dataAnc.results.bindings.forEach(row => {
          if (row.i?.value) qids.add(getQidFromUri(row.i.value));
        });
        qids.add(rootQid);
      }
      // Always add highlight QIDs (so they're always shown)
      for (const qid of highlightQidList) {
        qids.add(qid);
      }
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
      // (removed duplicate declarations of edgeSet, edges, propertyIds)

      // Store all items for modal
      const allItemsData = Array.from(qids).map(qid => {
        const itemJson = qidToItemJson[qid];
        const label = getLabelFromItemJson(itemJson) || qid;
        return { qid, label, itemJson };
      });
      setAllItems(allItemsData);

      // Add all nodes
      for (const qid of qids) {
        const itemJson = qidToItemJson[qid];
        const label = getLabelFromItemJson(itemJson) || qid;
        const img = getImageFilenameFromItemJson(itemJson);
        let nodeType = undefined;
        if (rootQidList.includes(qid)) {
          nodeType = 'root';
        } else if (highlightQidList.includes(qid)) {
          nodeType = 'highlight';
        }
        nodes[qid] = {
          data: {
            id: qid,
            label: qid + ': ' + label,
            img: img ? commonsDirectUrl('File:' + img) : undefined,
            itemJson,
            type: nodeType
          }
        };
      }

      // --- Sampling logic by level ---
      // 1. Build adjacency and reverse adjacency for BFS
      const childrenMap = {};
      const parentMap = {};
      for (const qid of qids) {
        childrenMap[qid] = [];
        parentMap[qid] = [];
      }
      for (const qid of qids) {
        const itemJson = qidToItemJson[qid];
        const p279s = itemJson?.statements?.P279 || [];
        for (const claim of p279s) {
          const parentQid = claim.value?.content;
          if (parentQid && qids.has(parentQid)) {
            childrenMap[parentQid].push(qid);
            parentMap[qid].push(parentQid);
          }
        }
        const p31s = itemJson?.statements?.P31 || [];
        for (const claim of p31s) {
          const parentQid = claim.value?.content;
          if (parentQid && qids.has(parentQid)) {
            childrenMap[parentQid].push(qid);
            parentMap[qid].push(parentQid);
          }
        }
      }
      // 2. BFS from all roots to assign levels
      const qidToLevel = {};
      const levelToQids = {};
      const visited = new Set();
      const queue = rootQidList.map(qid => [qid, 0]);
      while (queue.length > 0) {
        const [qid, level] = queue.shift();
        if (visited.has(qid)) continue;
        visited.add(qid);
        qidToLevel[qid] = level;
        if (!levelToQids[level]) levelToQids[level] = [];
        levelToQids[level].push(qid);
        for (const child of childrenMap[qid]) {
          queue.push([child, level + 1]);
        }
      }
      // 3. Sample nodes per level if needed
      const sampledLevels = new Set();
      const sampledQids = new Set();

      // Track all nodes and edges before sampling
      setTotalNodeCount(Object.keys(nodes).length);

      // We'll count edges before sampling as well
      let allEdgesBefore = 0;
      for (const qid of qids) {
        const itemJson = qidToItemJson[qid];
        const p279s = itemJson?.statements?.P279 || [];
        allEdgesBefore += p279s.length;
        const p31s = itemJson?.statements?.P31 || [];
        allEdgesBefore += p31s.length;
      }
      setTotalEdgeCount(allEdgesBefore);

      for (const [levelStr, qidArr] of Object.entries(levelToQids)) {
        const level = Number(levelStr);
        if (qidArr.length > appliedSampleCount) {
          sampledLevels.add(level);
          // Shuffle and sample
          const shuffled = [...qidArr].sort(() => Math.random() - 0.5);
          const keepCount = Math.ceil((appliedSampleRate / 100) * qidArr.length);
          const keepSet = new Set(shuffled.slice(0, keepCount));
          for (const qid of qidArr) {
            if (keepSet.has(qid)) {
              nodes[qid].data.sampledLevel = true;
              sampledQids.add(qid);
            }
          }
        } else {
          for (const qid of qidArr) {
            sampledQids.add(qid);
          }
        }
      }

      // --- Connectivity preservation: keep all nodes on paths from root to sampled nodes and highlight QIDs ---
      // BFS from each sampled node up to root, and from root down to sampled nodes
      const mustKeep = new Set();
      // Always keep highlight QIDs
      for (const qid of highlightQidList) {
        mustKeep.add(qid);
      }
      // Upwards: for each sampled node, walk up to root
      for (const qid of sampledQids) {
        let current = qid;
        while (current && !mustKeep.has(current)) {
          mustKeep.add(current);
          if (parentMap[current] && parentMap[current].length > 0) {
            for (const parent of parentMap[current]) {
              if (!mustKeep.has(parent)) {
                mustKeep.add(parent);
                current = parent;
              }
            }
            break;
          } else {
            break;
          }
        }
      }
      // For each highlight QID, walk up to any rootQid or sampled node, keeping all nodes along the path
      for (const highlightQid of highlightQidList) {
        // Only keep the path from highlightQid up to the first rootQid or sampled node encountered
        let queue = [[highlightQid]];
        const visitedHighlight = new Set();
        let foundConnection = false;
        let connectionPath = null;
        while (queue.length > 0 && !foundConnection) {
          const path = queue.shift();
          const current = path[path.length - 1];
          if (visitedHighlight.has(current)) continue;
          visitedHighlight.add(current);
          mustKeep.add(current);
          if (rootQidList.includes(current) || sampledQids.has(current)) {
            foundConnection = true;
            connectionPath = path;
            break;
          }
          if (parentMap[current] && parentMap[current].length > 0) {
            for (const parent of parentMap[current]) {
              if (!visitedHighlight.has(parent)) {
                queue.push([...path, parent]);
              }
            }
          }
        }
        if (connectionPath && connectionPath.length > 1) {
          for (let i = 0; i < connectionPath.length - 1; i++) {
            mustKeep.add(connectionPath[i]);
            mustKeep.add(connectionPath[i + 1]);
          }
        }
        // Downwards (children): ensure all paths from highlightQid to any rootQid or sampled node are also included
        let queueDown = [[highlightQid]];
        const visitedDown = new Set();
        while (queueDown.length > 0) {
          const path = queueDown.shift();
          const current = path[path.length - 1];
          if (visitedDown.has(current)) continue;
          visitedDown.add(current);
          mustKeep.add(current);
          if (rootQidList.includes(current) || sampledQids.has(current)) {
            continue;
          }
          if (childrenMap[current] && childrenMap[current].length > 0) {
            for (const child of childrenMap[current]) {
              if (!visitedDown.has(child)) {
                queueDown.push([...path, child]);
              }
            }
          }
        }
      }
      // Downwards: BFS from all roots, only keep paths that reach sampled nodes or highlight QIDs
      const queue2 = [...rootQidList, ...highlightQidList];
      while (queue2.length > 0) {
        const qid = queue2.shift();
        if (!mustKeep.has(qid)) continue;
        for (const child of childrenMap[qid] || []) {
          if (sampledQids.has(child) || mustKeep.has(child) || highlightQidList.includes(child)) {
            mustKeep.add(child);
            queue2.push(child);
          }
        }
      }
      // Remove nodes not in mustKeep
      for (const qid of Object.keys(nodes)) {
        if (!mustKeep.has(qid)) {
          delete nodes[qid];
        }
      }

      // Ensure all edges along highlight-to-root paths are present
      // (edges are added later, but we need to ensure both nodes are present, which is now done)
      
      // Update labels with counts after removal
      const shownCount = Object.keys(nodes).length;
      const totalCount = qids.size;
      for (const qid of Object.keys(nodes)) {
        const itemJson = qidToItemJson[qid];
        const label = getLabelFromItemJson(itemJson) || qid;
        nodes[qid].data.label = `${qid}\n${label}`;
        nodes[qid].data.shownCount = shownCount;
        nodes[qid].data.totalCount = totalCount;
      }
      // --- End connectivity preservation ---

      // Add edges based on P279 and P31 claims (and collect property ids)
      const edgeSet = new Set();
      let edges = [];
      const propertyIds = new Set();
      for (const qid of qids) {
        if (!nodes[qid]) continue;
        const itemJson = qidToItemJson[qid];
        // P279 edges
        const p279s = itemJson?.statements?.P279 || [];
        for (const claim of p279s) {
          const parentQid = claim.value?.content;
          if (parentQid && qids.has(parentQid) && nodes[parentQid] && nodes[qid]) {
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
          if (parentQid && qids.has(parentQid) && nodes[parentQid] && nodes[qid]) {
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
      // Filter edges to only those with both source and target present in nodes
      const nodeIds = new Set(Object.keys(nodes));
      edges = edges.filter(e =>
        nodeIds.has(e.data.source) && nodeIds.has(e.data.target)
      );
      // Track hidden nodes and edges
      
      // --- End sampling logic ---

      // Filter edges again after all node deletions to ensure no dangling references
      const nodeIdsFinal = new Set(Object.keys(nodes));
      edges = edges.filter(e =>
        nodeIdsFinal.has(e.data.source) && nodeIdsFinal.has(e.data.target)
      );
      
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
  }, [rootQids, appliedSampleRate, appliedSampleCount]);

  // Handler for input box
  function handleInputChange(e) {
    setInputQids(e.target.value);
  }
  function handleInputKeyDown(e) {
    if (e.key === 'Enter') {
      const trimmed = inputQids.trim();
      const qidList = trimmed.split(',').map(qid => qid.trim()).filter(qid => /^Q\d+$/.test(qid));
      if (qidList.length > 0) {
        setRootQids(trimmed);
      }
    }
  }
  function handleHighlightInputChange(e) {
    setInputHighlightQids(e.target.value);
  }
  function handleHighlightInputKeyDown(e) {
    if (e.key === 'Enter') {
      setHighlightQids(inputHighlightQids.trim());
    }
  }

  return (
    <div className="App" style={{ width: '100vw', height: '100vh', margin: 0, padding: 0, background: '#fafafa', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px 8px 16px', background: '#f0f0f0', borderBottom: '1px solid #ddd', display: 'flex', alignItems: 'center', zIndex: 2 }}>
        <label htmlFor="qid-input" style={{ fontWeight: 'bold', marginRight: 8 }}>IDs:</label>
        <input
          id="qid-input"
          type="text"
          value={inputQids}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          style={{ fontSize: 18, padding: '4px 8px', borderRadius: 4, border: '1px solid #bbb', width: 180 }}
          placeholder="Q144,Q5"
        />
        <label htmlFor="highlight-qid-input" style={{ fontWeight: 'bold', marginLeft: 16, marginRight: 8, color: 'green' }}>Highlight IDs:</label>
        <input
          id="highlight-qid-input"
          type="text"
          value={inputHighlightQids}
          onChange={handleHighlightInputChange}
          onKeyDown={handleHighlightInputKeyDown}
          style={{ fontSize: 18, padding: '4px 8px', borderRadius: 4, border: '1px solid #bbb', width: 180, background: '#eaffea' }}
          placeholder="Q42,Q1"
        />
        <div style={{ marginLeft: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          <label htmlFor="sample-rate" style={{ fontWeight: 'bold', marginRight: 4 }}>Sample Rate:</label>
          <input
            id="sample-rate"
            type="number"
            min={0}
            max={100}
            value={sampleRate}
            onChange={e => setSampleRate(Math.max(0, Math.min(100, Number(e.target.value))))}
            style={{ width: 60, padding: '2px 6px', borderRadius: 4, border: '1px solid #bbb', fontSize: 15 }}
          />
          <span style={{ marginRight: 8 }}>%</span>
          <label htmlFor="sample-count" style={{ fontWeight: 'bold', marginRight: 4 }}>Count:</label>
          <input
            id="sample-count"
            type="number"
            min={1}
            value={sampleCount}
            onChange={e => setSampleCount(Math.max(1, Number(e.target.value)))}
            style={{ width: 60, padding: '2px 6px', borderRadius: 4, border: '1px solid #bbb', fontSize: 15 }}
          />
          <button
            style={{
              marginLeft: 12,
              padding: '4px 14px',
              fontSize: 15,
              borderRadius: 4,
              border: '1px solid #888',
              background: (sampleRate !== appliedSampleRate || sampleCount !== appliedSampleCount) ? '#0074D9' : '#ccc',
              color: '#fff',
              fontWeight: 600,
              cursor: (sampleRate !== appliedSampleRate || sampleCount !== appliedSampleCount) ? 'pointer' : 'not-allowed',
              transition: 'background 0.2s'
            }}
            disabled={!(sampleRate !== appliedSampleRate || sampleCount !== appliedSampleCount)}
            onClick={() => {
              setAppliedSampleRate(sampleRate);
              setAppliedSampleCount(sampleCount);
            }}
          >
            Redraw Graph
          </button>
        </div>
        <div style={{ marginLeft: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showImages}
              onChange={e => setShowImages(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            Show Images
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label htmlFor="node-size" style={{ fontWeight: 'bold' }}>Node Size:</label>
            <input
              id="node-size"
              type="range"
              min={50}
              max={200}
              value={nodeSize}
              onChange={e => setNodeSize(Number(e.target.value))}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 14, minWidth: 30 }}>{nodeSize}</span>
          </div>
        </div>
        <span 
          style={{ marginLeft: 'auto', color: '#333', fontSize: 15, fontWeight: 500, cursor: 'pointer', textDecoration: 'underline' }}
          onClick={() => {
            const shownItems = allItems.filter(item => 
              elements.some(el => el.data && el.data.id === item.qid)
            );
            const hiddenItems = allItems.filter(item => 
              !elements.some(el => el.data && el.data.id === item.qid)
            );
            setModalData({
              nodeLabel: `All Items (${rootQids})`,
              shownItems,
              hiddenItems
            });
            setModalOpen(true);
          }}
        >
          Nodes: {elements.filter(el => el.data && el.data.id).length}/{totalNodeCount} | Edges: {elements.filter(el => el.data && el.data.source && el.data.target).length}/{totalEdgeCount}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <CytoscapeComponent
          key={layoutKey}
          elements={elements}
          layout={layout}
          stylesheet={getStylesheet(showImages, nodeSize)}
          style={{ width: '100vw', height: '100%', background: '#fafafa' }}
          cy={(cy) => {
            cyRef.current = cy;
          }}
        />
      </div>
      
      {modalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '20px',
            borderRadius: '8px',
            maxWidth: '80vw',
            maxHeight: '80vh',
            overflow: 'auto',
            minWidth: '500px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>Node Details</h2>
              <button 
                onClick={() => setModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  padding: '0',
                  width: '30px',
                  height: '30px'
                }}
              >
                ×
              </button>
            </div>
            
            {modalData && (
              <div>
                <p><strong>Selected:</strong> {modalData.nodeLabel}</p>
                <p><strong>Shown:</strong> {modalData.shownItems.length} | <strong>Hidden:</strong> {modalData.hiddenItems.length}</p>
                
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f5f5f5' }}>
                      <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Status</th>
                      <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>QID</th>
                      <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalData.shownItems.map(item => (
                      <tr key={item.qid}>
                        <td style={{ padding: '8px', border: '1px solid #ddd', color: 'green' }}>Shown</td>
                        <td style={{ padding: '8px', border: '1px solid #ddd' }}>{item.qid}</td>
                        <td style={{ padding: '8px', border: '1px solid #ddd' }}>{item.label}</td>
                      </tr>
                    ))}
                    {modalData.hiddenItems.map(item => (
                      <tr key={item.qid}>
                        <td style={{ padding: '8px', border: '1px solid #ddd', color: 'red' }}>Hidden</td>
                        <td style={{ padding: '8px', border: '1px solid #ddd' }}>{item.qid}</td>
                        <td style={{ padding: '8px', border: '1px solid #ddd' }}>{item.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
