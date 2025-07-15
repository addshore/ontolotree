import React, { useEffect, useState, useRef } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import ReactFlowGraph from './ReactFlowGraph';
import md5 from 'md5';
import pLimit from 'p-limit';
import './App.css';
import { Sidebar } from 'primereact/sidebar';
import { Button } from 'primereact/button';
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
function getLayout(elements) {
  return {
    name: 'breadthfirst',
    fit: true,
    directed: true,
    padding: 30,
    circle: false,
    grid: true,
    spacingFactor: 1.75,
    boundingBox: undefined,
    avoidOverlap: true,
    nodeDimensionsIncludeLabels: false,
    roots: undefined,
    depthSort: undefined,
    animate: false,
    animationDuration: 500,
    animationEasing: undefined,
    animateFilter: function (node, i) { return true; },
    ready: undefined,
    stop: undefined,
    transform: function (node, position) { return position; }
  };
}
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
  const [graphType, setGraphType] = useState('cytoscape'); // 'cytoscape' or 'reactflow'
  const [upwardQids, setUpwardQids] = useState(() => {
    const stored = localStorage.getItem('ontolotree-upwardQids');
    return stored ? stored.split(',').map(qid => qid.trim()).filter(qid => /^Q\d+$/.test(qid)) : ['Q144'];
  });
  const [downwardQids, setDownwardQids] = useState(() => {
    const stored = localStorage.getItem('ontolotree-downwardQids');
    return stored ? stored.split(',').map(qid => qid.trim()).filter(qid => /^Q\d+$/.test(qid)) : [];
  });
  const [inputUpwardQid, setInputUpwardQid] = useState('');
  const [inputDownwardQid, setInputDownwardQid] = useState('');
  const [upwardQidLabels, setUpwardQidLabels] = useState([]);
  const [downwardQidLabels, setDownwardQidLabels] = useState([]);
  const [highlightQids, setHighlightQids] = useState(() => {
    const stored = localStorage.getItem('ontolotree-highlightQids');
    return stored ? stored.split(',').map(qid => qid.trim()).filter(qid => /^Q\d+$/.test(qid)) : [];
  });
  const [inputHighlightQid, setInputHighlightQid] = useState('');
  const [highlightQidLabels, setHighlightQidLabels] = useState([]);
  const [upwardSearchSuggestions, setUpwardSearchSuggestions] = useState([]);
  const [downwardSearchSuggestions, setDownwardSearchSuggestions] = useState([]);
  const [highlightSearchSuggestions, setHighlightSearchSuggestions] = useState([]);
  const [showUpwardSuggestions, setShowUpwardSuggestions] = useState(false);
  const [showDownwardSuggestions, setShowDownwardSuggestions] = useState(false);
  const [showHighlightSuggestions, setShowHighlightSuggestions] = useState(false);
  const [showImages, setShowImages] = useState(() => localStorage.getItem('ontolotree-showImages') !== 'false');
  const [nodeSize, setNodeSize] = useState(() => Number(localStorage.getItem('ontolotree-nodeSize')) || 100);

  // Pending values for inputs
  const [sampleRate, setSampleRate] = useState(() => Number(localStorage.getItem('ontolotree-sampleRate')) || 100);
  const [sampleCount, setSampleCount] = useState(() => Number(localStorage.getItem('ontolotree-sampleCount')) || 10);
  const [minNodes, setMinNodes] = useState(() => Number(localStorage.getItem('ontolotree-minNodes')) || 1);
  const [maxNodes, setMaxNodes] = useState(() => Number(localStorage.getItem('ontolotree-maxNodes')) || 50);
  // Applied values for graph
  const [appliedSampleRate, setAppliedSampleRate] = useState(() => Number(localStorage.getItem('ontolotree-sampleRate')) || 100);
  const [appliedSampleCount, setAppliedSampleCount] = useState(() => Number(localStorage.getItem('ontolotree-sampleCount')) || 10);
  const [totalNodeCount, setTotalNodeCount] = useState(0);
  const [totalEdgeCount, setTotalEdgeCount] = useState(0);
  const [allItems, setAllItems] = useState([]);
  const [loadingProgress, setLoadingProgress] = useState({ total: 0, completed: 0, isLoading: false, step: '' });
  const cyRef = useRef(null);

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem('ontolotree-upwardQids', upwardQids.join(','));
  }, [upwardQids]);

  useEffect(() => {
    localStorage.setItem('ontolotree-downwardQids', downwardQids.join(','));
  }, [downwardQids]);

  useEffect(() => {
    localStorage.setItem('ontolotree-highlightQids', highlightQids.join(','));
  }, [highlightQids]);

  useEffect(() => {
    localStorage.setItem('ontolotree-sampleRate', sampleRate.toString());
  }, [sampleRate]);

  useEffect(() => {
    localStorage.setItem('ontolotree-sampleCount', sampleCount.toString());
  }, [sampleCount]);

  useEffect(() => {
    localStorage.setItem('ontolotree-minNodes', minNodes.toString());
  }, [minNodes]);

  useEffect(() => {
    localStorage.setItem('ontolotree-maxNodes', maxNodes.toString());
  }, [maxNodes]);

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

  // Check URL for auto-draw parameter
  const shouldAutoDraw = new URLSearchParams(window.location.search).get('draw') === '1';
  
  // Manual draw function
  const drawGraph = async () => {
      // Use upward/downward QIDs
      const rootQidList = [...upwardQids, ...downwardQids];
      const highlightQidList = highlightQids;
      if (upwardQids.length === 0 && downwardQids.length === 0) return;
      
      // 1. Get all descendants (P279/P31) and all ancestors (reverse P279) for all root QIDs
      const qids = new Set();
      
      // Fetch upward trees (ancestors) only if upwardQids exist
      if (upwardQids.length > 0) {
        for (const rootQid of upwardQids) {
          const descendantQuery = generateSimpleSubclassOrInstanceQuery(rootQid);
          
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
          dataDesc.results.bindings.forEach(row => {
            if (row.i?.value) qids.add(getQidFromUri(row.i.value));
          });
          qids.add(rootQid);
        }
      }
      
      // Fetch downward trees (descendants) only if downwardQids exist
      if (downwardQids.length > 0) {
        for (const rootQid of downwardQids) {
          const ancestorQuery = generateSimpleSuperclassQuery(rootQid);
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
          dataAnc.results.bindings.forEach(row => {
            if (row.i?.value) qids.add(getQidFromUri(row.i.value));
          });
          qids.add(rootQid);
        }
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
      const limit = pLimit(5);
      const qidToItemJson = {};
      const qidArray = Array.from(qids);
      setLoadingProgress({ total: qidArray.length, completed: 0, isLoading: true, step: 'Fetching entities' });
      
      let completed = 0;
      await Promise.all(qidArray.map(qid =>
        limit(() => fetchWithBackoff(() => fetchWikidataItemJsonMemo(qid)))
          .then(json => { 
            qidToItemJson[qid] = json; 
            completed++;
            setLoadingProgress(prev => ({ ...prev, completed }));
          })
          .catch(e => { 
            console.warn('Failed to fetch item JSON for', qid, e); 
            completed++;
            setLoadingProgress(prev => ({ ...prev, completed }));
          })
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
        if (upwardQids.includes(qid) || downwardQids.includes(qid)) {
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
      setLoadingProgress(prev => ({ ...prev, step: 'Building graph structure' }));
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
          // Shuffle and sample with min/max constraints
          const shuffled = [...qidArr].sort(() => Math.random() - 0.5);
          let keepCount = Math.ceil((appliedSampleRate / 100) * qidArr.length);
          keepCount = Math.max(minNodes, Math.min(maxNodes, keepCount));
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
      setLoadingProgress(prev => ({ ...prev, step: 'Computing connectivity paths' }));
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
      // For each highlight QID, keep all nodes on any path to each root QID (not just shortest)
      function findAllPaths(start, end, parentMap, childrenMap, maxDepth = 15) {
        const paths = [];
        function dfs(current, path, visited, depth) {
          if (depth > maxDepth) return;
          if (current === end) {
            paths.push([...path, current]);
            return;
          }
          visited.add(current);
          // Upwards
          for (const parent of parentMap[current] || []) {
            if (!visited.has(parent)) {
              dfs(parent, [...path, current], new Set(visited), depth + 1);
            }
          }
          // Downwards
          for (const child of childrenMap[current] || []) {
            if (!visited.has(child)) {
              dfs(child, [...path, current], new Set(visited), depth + 1);
            }
          }
        }
        dfs(start, [], new Set(), 0);
        return paths;
      }
      for (const highlightQid of highlightQidList) {
        for (const rootQid of rootQidList) {
          const allPaths = findAllPaths(highlightQid, rootQid, parentMap, childrenMap, 15);
          for (const path of allPaths) {
            for (const qid of path) {
              mustKeep.add(qid);
            }
          }
        }
      }
      // Downwards: BFS from all roots, only keep paths that reach sampled nodes or highlight QIDs
      setLoadingProgress(prev => ({ ...prev, step: 'Processing connectivity', total: 0, completed: 0 }));
      const queue2 = [...rootQidList, ...highlightQidList];
      const visited2 = new Set();
      let processedCount = 0;
      while (queue2.length > 0) {
        const qid = queue2.shift();
        if (visited2.has(qid)) continue;
        visited2.add(qid);
        processedCount++;
        if (processedCount % 100 === 0) {
          setLoadingProgress(prev => ({ ...prev, step: `Processing connectivity: ${processedCount} nodes`, total: 0, completed: 0 }));
          await new Promise(resolve => setTimeout(resolve, 1));
        }
        if (!mustKeep.has(qid)) continue;
        for (const child of childrenMap[qid] || []) {
          if (!visited2.has(child) && (sampledQids.has(child) || mustKeep.has(child) || highlightQidList.includes(child))) {
            mustKeep.add(child);
            queue2.push(child);
          }
        }
      }
      // Keep all sampled nodes plus connectivity nodes
      console.log('mustKeep size:', mustKeep.size);
      console.log('sampledQids size:', sampledQids.size);
      
      // Only remove nodes if they're not sampled and not in mustKeep
      for (const qid of Object.keys(nodes)) {
        if (!sampledQids.has(qid) && !mustKeep.has(qid) && !rootQidList.includes(qid) && !highlightQidList.includes(qid)) {
          delete nodes[qid];
        }
      }

      // --- Remove disconnected islands: only keep nodes reachable from roots or highlight nodes ---
      const reachable = new Set();
      const stack = [...rootQidList, ...highlightQidList].filter(qid => nodes[qid]);
      while (stack.length > 0) {
        const qid = stack.pop();
        if (reachable.has(qid)) continue;
        reachable.add(qid);
        // Traverse children (downwards)
        for (const child of childrenMap[qid] || []) {
          if (nodes[child] && !reachable.has(child)) {
            stack.push(child);
          }
        }
        // Traverse parents (upwards)
        for (const parent of parentMap[qid] || []) {
          if (nodes[parent] && !reachable.has(parent)) {
            stack.push(parent);
          }
        }
      }
      // Remove any nodes not in reachable set
      for (const qid of Object.keys(nodes)) {
        if (!reachable.has(qid)) {
          delete nodes[qid];
        }
      }
      
      console.log('Total nodes after connectivity filtering:', Object.keys(nodes).length);

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
      
      // Create edges for all remaining nodes, checking against the original qids set
      for (const qid of Object.keys(nodes)) {
        const itemJson = qidToItemJson[qid];
        if (!itemJson) continue;
        
        // P279 edges
        const p279s = itemJson?.statements?.P279 || [];
        for (const claim of p279s) {
          const parentQid = claim.value?.content;
          if (parentQid && nodes[parentQid]) {
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
          if (parentQid && nodes[parentQid]) {
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
      const propertyArray = Array.from(propertyIds);
      if (propertyArray.length > 0) {
        setLoadingProgress(prev => ({ ...prev, total: prev.total + propertyArray.length }));
        await Promise.all(propertyArray.map(pid =>
          limit(() => fetchWithBackoff(() => fetchWikidataPropertyJsonMemo(pid)))
            .then(propertyJson => { 
              pidToLabel[pid] = getLabelFromPropertyJson(propertyJson) || pid; 
              completed++;
              setLoadingProgress(prev => ({ ...prev, completed }));
            })
            .catch(e => { 
              console.warn('Failed to fetch property JSON for', pid, e); 
              pidToLabel[pid] = pid;
              completed++;
              setLoadingProgress(prev => ({ ...prev, completed }));
            })
        ));
      }
      // Add property label to edge data
      edges.forEach(edge => {
        edge.data.propertyLabel = pidToLabel[edge.data.property] || edge.data.property;
      });
      
      // Use setTimeout to prevent UI blocking
      setTimeout(() => {
        setElements([...Object.values(nodes), ...edges]);
        setLayoutKey(prev => prev + 1);
        setLoadingProgress({ total: 0, completed: 0, isLoading: false, step: '' });
      }, 10);
  };
  
  // Auto-draw on mount if URL parameter is set
  useEffect(() => {
    if (shouldAutoDraw && (upwardQids.length > 0 || downwardQids.length > 0)) {
      drawGraph();
    }
  }, []);

  // Search functionality
  const searchWikidata = async (query) => {
    if (!query || query.length < 2) return [];
    try {
      const response = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&format=json&origin=*&limit=10`
      );
      const data = await response.json();
      return data.search || [];
    } catch (error) {
      console.error('Search failed:', error);
      return [];
    }
  };

  const handleSearchInput = async (value, type = 'upward') => {
    if (type === 'highlight') {
      setInputHighlightQid(value);
    } else if (type === 'upward') {
      setInputUpwardQid(value);
    } else if (type === 'downward') {
      setInputDownwardQid(value);
    }
    
    if (value.length >= 2) {
      const suggestions = await searchWikidata(value);
      if (type === 'highlight') {
        setHighlightSearchSuggestions(suggestions);
        setShowHighlightSuggestions(true);
      } else if (type === 'upward') {
        setUpwardSearchSuggestions(suggestions);
        setShowUpwardSuggestions(true);
      } else if (type === 'downward') {
        setDownwardSearchSuggestions(suggestions);
        setShowDownwardSuggestions(true);
      }
    } else {
      if (type === 'highlight') {
        setHighlightSearchSuggestions([]);
        setShowHighlightSuggestions(false);
      } else if (type === 'upward') {
        setUpwardSearchSuggestions([]);
        setShowUpwardSuggestions(false);
      } else if (type === 'downward') {
        setDownwardSearchSuggestions([]);
        setShowDownwardSuggestions(false);
      }
    }
  };

  const selectSuggestion = (suggestion, type = 'upward') => {
    const qid = suggestion.id;
    if (type === 'highlight') {
      if (/^Q\d+$/.test(qid) && !highlightQids.includes(qid)) {
        setHighlightQids(prev => [...prev, qid]);
      }
      setInputHighlightQid('');
      setHighlightSearchSuggestions([]);
      setShowHighlightSuggestions(false);
    } else if (type === 'upward') {
      if (/^Q\d+$/.test(qid) && !upwardQids.includes(qid)) {
        setUpwardQids(prev => [...prev, qid]);
      }
      setInputUpwardQid('');
      setUpwardSearchSuggestions([]);
      setShowUpwardSuggestions(false);
    } else if (type === 'downward') {
      if (/^Q\d+$/.test(qid) && !downwardQids.includes(qid)) {
        setDownwardQids(prev => [...prev, qid]);
      }
      setInputDownwardQid('');
      setDownwardSearchSuggestions([]);
      setShowDownwardSuggestions(false);
    }
  };

  // Sidebar collapse state
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const [isResizing, setIsResizing] = useState(false);

  // Fetch labels for upwardQids
  useEffect(() => {
    let cancelled = false;
    async function fetchLabels() {
      const labels = await Promise.all(
        upwardQids.map(async qid => {
          try {
            const json = await fetchWikidataItemJsonMemo(qid);
            return { qid, label: getLabelFromItemJson(json) || qid };
          } catch {
            return { qid, label: qid };
          }
        })
      );
      if (!cancelled) setUpwardQidLabels(labels);
    }
    fetchLabels();
    return () => { cancelled = true; };
  }, [upwardQids]);

  // Fetch labels for downwardQids
  useEffect(() => {
    let cancelled = false;
    async function fetchLabels() {
      const labels = await Promise.all(
        downwardQids.map(async qid => {
          try {
            const json = await fetchWikidataItemJsonMemo(qid);
            return { qid, label: getLabelFromItemJson(json) || qid };
          } catch {
            return { qid, label: qid };
          }
        })
      );
      if (!cancelled) setDownwardQidLabels(labels);
    }
    fetchLabels();
    return () => { cancelled = true; };
  }, [downwardQids]);

  // Fetch labels for highlightQids
  useEffect(() => {
    let cancelled = false;
    async function fetchLabels() {
      if (highlightQids.length === 0) {
        setHighlightQidLabels([]);
        return;
      }
      const labels = await Promise.all(
        highlightQids.map(async qid => {
          try {
            const json = await fetchWikidataItemJsonMemo(qid);
            return { qid, label: getLabelFromItemJson(json) || qid };
          } catch {
            return { qid, label: qid };
          }
        })
      );
      if (!cancelled) setHighlightQidLabels(labels);
    }
    fetchLabels();
    return () => { cancelled = true; };
  }, [highlightQids]);

  // Handle sidebar resizing with window listeners
  useEffect(() => {
    function onMouseMove(e) {
      if (isResizing) {
        e.preventDefault();
        const minW = 220;
        const maxW = 600;
        setSidebarWidth(Math.max(minW, Math.min(maxW, e.clientX)));
      }
    }
    function onMouseUp() {
      if (isResizing) setIsResizing(false);
    }
    if (isResizing) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isResizing]);
  

  
  const [sidebarTableData, setSidebarTableData] = useState(null);

  // Compute sidebar table data on elements/allItems/upwardQids/downwardQids/highlightQids change
  useEffect(() => {
    const rootQidList = [...upwardQids, ...downwardQids];
    const highlightQidList = highlightQids;
    const shownItems = allItems.filter(item =>
      elements.some(el => el.data && el.data.id === item.qid)
    ).map(item => {
      let reason = 'shown';
      if (rootQidList.includes(item.qid)) {
        reason = 'shown (primary)';
      } else if (highlightQidList.includes(item.qid)) {
        reason = 'shown (highlight)';
      } else {
        const element = elements.find(el => el.data && el.data.id === item.qid);
        if (element && element.data.sampledLevel) {
          reason = 'shown (sampled level)';
        } else {
          reason = 'shown (connectivity)';
        }
      }
      return { ...item, reason };
    });
    const hiddenItems = allItems.filter(item =>
      !elements.some(el => el.data && el.data.id === item.qid)
    ).map(item => ({ ...item, reason: 'hidden (sampled)' }));
    setSidebarTableData({
      nodeLabel: `All Items (${[...upwardQids, ...downwardQids].join(', ')})`,
      shownItems,
      hiddenItems
    });
  }, [elements, allItems, upwardQids, downwardQids, highlightQids]);

  return (
    <div
      className="App"
      style={{
        width: '100vw',
        height: '100vh',
        margin: 0,
        padding: 0,
        background: '#fafafa',
        display: 'flex',
        flexDirection: 'row',
        userSelect: isResizing ? 'none' : undefined
      }}
      // Remove onMouseMove and onMouseUp from here
    >
      <Button icon="pi pi-bars" className="menu-toggle-btn" onClick={() => setSidebarVisible(true)} />
      <Sidebar
        visible={sidebarVisible}
        onHide={() => { if (!isResizing) setSidebarVisible(false); }}
        showCloseIcon={false}
        blockScroll={false}
        dismissable={false}
        style={{ width: sidebarWidth, zIndex: 11, paddingRight: 0 }}
        className="custom-sidebar"
        modal={false}
      >
        <Button
          icon="pi pi-times"
          className="p-button-rounded p-button-text"
          style={{ position: 'absolute', top: 8, left: 8, zIndex: 20 }}
          onClick={() => setSidebarVisible(false)}
          aria-label="Close"
        />
        <div className="sidebar-content">
          <section className="sidebar-section">
            <label htmlFor="upward-qid-input" style={{ fontWeight: 'bold', marginRight: 8 }}>Upward tree from:</label>
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <input
                id="upward-qid-input"
                type="text"
                value={inputUpwardQid}
                onChange={e => handleSearchInput(e.target.value, 'upward')}
                onKeyDown={async e => {
                  if (e.key === 'Enter') {
                    const entries = inputUpwardQid.split(',').map(q => q.trim()).filter(Boolean);
                    let added = false;
                    for (const qid of entries) {
                      if (/^Q\d+$/.test(qid) && !upwardQids.includes(qid)) {
                        setUpwardQids(prev => [...prev, qid]);
                        added = true;
                      }
                    }
                    if (added) setInputUpwardQid('');
                    setShowUpwardSuggestions(false);
                  } else if (e.key === 'Escape') {
                    setShowUpwardSuggestions(false);
                  }
                }}
                onBlur={() => setTimeout(() => setShowUpwardSuggestions(false), 200)}
                style={{ fontSize: 16, padding: '4px 8px', borderRadius: 4, border: '1px solid #bbb', width: '100%' }}
                placeholder="Search or enter Q144,Q5"
              />
              {showUpwardSuggestions && upwardSearchSuggestions.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: '#fff',
                  border: '1px solid #bbb',
                  borderTop: 'none',
                  borderRadius: '0 0 4px 4px',
                  maxHeight: 200,
                  overflowY: 'auto',
                  zIndex: 1000,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  {upwardSearchSuggestions.map(suggestion => (
                    <div
                      key={suggestion.id}
                      onClick={() => selectSuggestion(suggestion, 'upward')}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        borderBottom: '1px solid #eee',
                        fontSize: 14
                      }}
                      onMouseEnter={e => e.target.style.background = '#f5f5f5'}
                      onMouseLeave={e => e.target.style.background = '#fff'}
                    >
                      <div style={{ fontWeight: 'bold', color: '#0074D9' }}>{suggestion.id}</div>
                      <div style={{ color: '#333' }}>{suggestion.label}</div>
                      {suggestion.description && (
                        <div style={{ color: '#666', fontSize: 12 }}>{suggestion.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="qid-chip-list">
              {upwardQids.map(qid => {
                const labelObj = upwardQidLabels.find(l => l.qid === qid);
                return (
                  <span className="qid-chip" key={qid}>
                    <span className="qid-chip-id">{qid}</span>
                    {labelObj && labelObj.label && (
                      <span className="qid-chip-label">{labelObj.label}</span>
                    )}
                    <button
                      className="qid-chip-remove"
                      onClick={() => setUpwardQids(upwardQids.filter(id => id !== qid))}
                      aria-label={`Remove ${qid}`}
                    >×</button>
                  </span>
                );
              })}
            </div>
            <label htmlFor="downward-qid-input" style={{ fontWeight: 'bold', marginTop: 8, marginRight: 8 }}>Downward tree from:</label>
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <input
                id="downward-qid-input"
                type="text"
                value={inputDownwardQid}
                onChange={e => handleSearchInput(e.target.value, 'downward')}
                onKeyDown={async e => {
                  if (e.key === 'Enter') {
                    const entries = inputDownwardQid.split(',').map(q => q.trim()).filter(Boolean);
                    let added = false;
                    for (const qid of entries) {
                      if (/^Q\d+$/.test(qid) && !downwardQids.includes(qid)) {
                        setDownwardQids(prev => [...prev, qid]);
                        added = true;
                      }
                    }
                    if (added) setInputDownwardQid('');
                    setShowDownwardSuggestions(false);
                  } else if (e.key === 'Escape') {
                    setShowDownwardSuggestions(false);
                  }
                }}
                onBlur={() => setTimeout(() => setShowDownwardSuggestions(false), 200)}
                style={{ fontSize: 16, padding: '4px 8px', borderRadius: 4, border: '1px solid #bbb', width: '100%' }}
                placeholder="Search or enter Q5,Q35120"
              />
              {showDownwardSuggestions && downwardSearchSuggestions.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: '#fff',
                  border: '1px solid #bbb',
                  borderTop: 'none',
                  borderRadius: '0 0 4px 4px',
                  maxHeight: 200,
                  overflowY: 'auto',
                  zIndex: 1000,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  {downwardSearchSuggestions.map(suggestion => (
                    <div
                      key={suggestion.id}
                      onClick={() => selectSuggestion(suggestion, 'downward')}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        borderBottom: '1px solid #eee',
                        fontSize: 14
                      }}
                      onMouseEnter={e => e.target.style.background = '#f5f5f5'}
                      onMouseLeave={e => e.target.style.background = '#fff'}
                    >
                      <div style={{ fontWeight: 'bold', color: '#0074D9' }}>{suggestion.id}</div>
                      <div style={{ color: '#333' }}>{suggestion.label}</div>
                      {suggestion.description && (
                        <div style={{ color: '#666', fontSize: 12 }}>{suggestion.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="qid-chip-list">
              {downwardQids.map(qid => {
                const labelObj = downwardQidLabels.find(l => l.qid === qid);
                return (
                  <span className="qid-chip" key={qid}>
                    <span className="qid-chip-id">{qid}</span>
                    {labelObj && labelObj.label && (
                      <span className="qid-chip-label">{labelObj.label}</span>
                    )}
                    <button
                      className="qid-chip-remove"
                      onClick={() => setDownwardQids(downwardQids.filter(id => id !== qid))}
                      aria-label={`Remove ${qid}`}
                    >×</button>
                  </span>
                );
              })}
            </div>
            <label htmlFor="highlight-qid-input" style={{ fontWeight: 'bold', marginTop: 8, marginRight: 8, color: 'green' }}>Highlight IDs:</label>
            <div style={{ position: 'relative' }}>
              <input
                id="highlight-qid-input"
                type="text"
                value={inputHighlightQid}
                onChange={e => handleSearchInput(e.target.value, 'highlight')}
                onKeyDown={async e => {
                  if (e.key === 'Enter') {
                    const entries = inputHighlightQid.split(',').map(q => q.trim()).filter(Boolean);
                    let added = false;
                    for (const qid of entries) {
                      if (/^Q\d+$/.test(qid) && !highlightQids.includes(qid)) {
                        setHighlightQids(prev => [...prev, qid]);
                        added = true;
                      }
                    }
                    if (added) setInputHighlightQid('');
                    setShowHighlightSuggestions(false);
                  } else if (e.key === 'Escape') {
                    setShowHighlightSuggestions(false);
                  }
                }}
                onBlur={() => setTimeout(() => setShowHighlightSuggestions(false), 200)}
                style={{ fontSize: 16, padding: '4px 8px', borderRadius: 4, border: '1px solid #bbb', width: '100%', background: '#eaffea' }}
                placeholder="Search or enter Q42,Q1"
              />
              {showHighlightSuggestions && highlightSearchSuggestions.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: '#fff',
                  border: '1px solid #bbb',
                  borderTop: 'none',
                  borderRadius: '0 0 4px 4px',
                  maxHeight: 200,
                  overflowY: 'auto',
                  zIndex: 1000,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  {highlightSearchSuggestions.map(suggestion => (
                    <div
                      key={suggestion.id}
                      onClick={() => selectSuggestion(suggestion, 'highlight')}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        borderBottom: '1px solid #eee',
                        fontSize: 14
                      }}
                      onMouseEnter={e => e.target.style.background = '#f5f5f5'}
                      onMouseLeave={e => e.target.style.background = '#fff'}
                    >
                      <div style={{ fontWeight: 'bold', color: '#0074D9' }}>{suggestion.id}</div>
                      <div style={{ color: '#333' }}>{suggestion.label}</div>
                      {suggestion.description && (
                        <div style={{ color: '#666', fontSize: 12 }}>{suggestion.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="qid-chip-list">
              {highlightQids.map(qid => {
                const labelObj = highlightQidLabels.find(l => l.qid === qid);
                return (
                  <span className="qid-chip" key={qid}>
                    <span className="qid-chip-id">{qid}</span>
                    {labelObj && labelObj.label && (
                      <span className="qid-chip-label">{labelObj.label}</span>
                    )}
                    <button
                      className="qid-chip-remove"
                      onClick={() => setHighlightQids(highlightQids.filter(id => id !== qid))}
                      aria-label={`Remove ${qid}`}
                    >×</button>
                  </span>
                );
              })}
            </div>
          </section>
          {/* Loading Progress */}
          {loadingProgress.isLoading && (
            <section className="sidebar-section">
              <h3>Loading Progress</h3>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 14, marginBottom: 4 }}>
                  {loadingProgress.step}
                  {loadingProgress.total > 0 && `: ${loadingProgress.completed} / ${loadingProgress.total}`}
                </div>
                <div style={{
                  width: '100%',
                  height: 8,
                  background: '#eee',
                  borderRadius: 4,
                  overflow: 'hidden'
                }}>
                  <div style={{
                    width: `${loadingProgress.total > 0 ? (loadingProgress.completed / loadingProgress.total) * 100 : 0}%`,
                    height: '100%',
                    background: '#0074D9',
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              </div>
            </section>
          )}
          {/* Filtering */}
          <section className="sidebar-section">
            <h3>Filtering</h3>
            <label htmlFor="sample-rate" style={{ fontWeight: 'bold', marginRight: 4 }}>Sample Rate:</label>
            <input
              id="sample-rate"
              type="number"
              min={0}
              max={100}
              value={sampleRate}
              onChange={e => setSampleRate(Math.max(0, Math.min(100, Number(e.target.value))))}
              style={{ width: 60, padding: '2px 6px', borderRadius: 4, border: '1px solid #bbb', fontSize: 15, marginRight: 8 }}
            />
            <span style={{ marginRight: 8 }}>%</span>
            <label htmlFor="sample-count" style={{ fontWeight: 'bold', marginRight: 4 }}>Count:</label>
            <input
              id="sample-count"
              type="number"
              min={1}
              value={sampleCount}
              onChange={e => setSampleCount(Math.max(1, Number(e.target.value)))}
              style={{ width: 60, padding: '2px 6px', borderRadius: 4, border: '1px solid #bbb', fontSize: 15, marginRight: 8 }}
            />
            <br />
            <label htmlFor="min-nodes" style={{ fontWeight: 'bold', marginRight: 4 }}>Min:</label>
            <input
              id="min-nodes"
              type="number"
              min={1}
              value={minNodes}
              onChange={e => setMinNodes(Math.max(1, Number(e.target.value)))}
              style={{ width: 50, padding: '2px 6px', borderRadius: 4, border: '1px solid #bbb', fontSize: 15, marginRight: 8 }}
            />
            <label htmlFor="max-nodes" style={{ fontWeight: 'bold', marginRight: 4 }}>Max:</label>
            <input
              id="max-nodes"
              type="number"
              min={1}
              value={maxNodes}
              onChange={e => setMaxNodes(Math.max(1, Number(e.target.value)))}
              style={{ width: 50, padding: '2px 6px', borderRadius: 4, border: '1px solid #bbb', fontSize: 15, marginRight: 8 }}
            />
            <button
              style={{
                marginLeft: 0,
                marginTop: 8,
                padding: '4px 14px',
                fontSize: 15,
                borderRadius: 4,
                border: '1px solid #888',
                background: '#0074D9',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.2s'
              }}
              disabled={loadingProgress.isLoading || (upwardQids.length === 0 && downwardQids.length === 0)}
              onClick={() => {
                setAppliedSampleRate(sampleRate);
                setAppliedSampleCount(sampleCount);
                drawGraph();
              }}
            >
              Draw Graph
            </button>
          </section>
          {/* Display */}
          <section className="sidebar-section">
            <h3>Display</h3>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', marginBottom: 8 }}>
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

            {/* Graph library selection */}
            <div style={{ marginTop: 8 }}>
              <label style={{ fontWeight: 'bold', marginRight: 8 }}>Graph Library:</label>
              <button
                onClick={() => setGraphType('cytoscape')}
                style={{
                  marginRight: 8,
                  padding: '4px 14px',
                  borderRadius: 4,
                  border: graphType === 'cytoscape' ? '2px solid #0074D9' : '1px solid #bbb',
                  background: graphType === 'cytoscape' ? '#e6f7ff' : '#fff',
                  color: '#0074D9',
                  fontWeight: graphType === 'cytoscape' ? 700 : 400,
                  cursor: 'pointer'
                }}
              >
                Cytoscape
              </button>
              <button
                onClick={() => setGraphType('reactflow')}
                style={{
                  padding: '4px 14px',
                  borderRadius: 4,
                  border: graphType === 'reactflow' ? '2px solid #0074D9' : '1px solid #bbb',
                  background: graphType === 'reactflow' ? '#e6f7ff' : '#fff',
                  color: '#0074D9',
                  fontWeight: graphType === 'reactflow' ? 700 : 400,
                  cursor: 'pointer'
                }}
              >
                React Flow
              </button>
            </div>
          </section>
          {/* Stats */}
          <section className="sidebar-section">
            <h3>Stats</h3>
            <span className="sidebar-stats">
              Nodes: {elements.filter(el => el.data && el.data.id).length}/{totalNodeCount}
              <br />
              Edges: {elements.filter(el => el.data && el.data.source && el.data.target).length}/{totalEdgeCount}
            </span>
          </section>
          {/* Table always at bottom */}
          <div className="sidebar-table">
            {sidebarTableData && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <strong>{sidebarTableData.nodeLabel}</strong>
                </div>
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  <span><strong>Shown:</strong> {sidebarTableData.shownItems.length} | <strong>Hidden:</strong> {sidebarTableData.hiddenItems.length}</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f5f5f5' }}>
                      <th style={{ padding: '6px', textAlign: 'left', border: '1px solid #ddd' }}>QID</th>
                      <th style={{ padding: '6px', textAlign: 'left', border: '1px solid #ddd' }}>Label</th>
                      <th style={{ padding: '6px', textAlign: 'left', border: '1px solid #ddd' }}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sidebarTableData.shownItems.map(item => (
                      <tr key={item.qid} style={{ backgroundColor: 'white' }}>
                        <td style={{ padding: '4px', border: '1px solid #ddd' }}>{item.qid}</td>
                        <td style={{ padding: '4px', border: '1px solid #ddd' }}>{item.label}</td>
                        <td style={{ padding: '4px', border: '1px solid #ddd', color: 'green' }}>{item.reason}</td>
                      </tr>
                    ))}
                    {sidebarTableData.hiddenItems.map(item => (
                      <tr key={item.qid}>
                        <td style={{ padding: '4px', border: '1px solid #ddd' }}>{item.qid}</td>
                        <td style={{ padding: '4px', border: '1px solid #ddd' }}>{item.label}</td>
                        <td style={{ padding: '4px', border: '1px solid #ddd', color: 'red' }}>{item.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
          {/* Minimal raw data for LLM */}
          <div style={{ marginTop: 12 }}>
            <label style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 2, display: 'block' }}>
              Raw node/edge state (for LLM):
            </label>
            <textarea
              readOnly
              style={{
                width: '100%',
                minHeight: 90,
                fontFamily: 'monospace',
                fontSize: 12,
                background: '#f7f7f7',
                border: '1px solid #bbb',
                borderRadius: 4,
                resize: 'vertical',
                color: '#222',
                padding: 6,
                marginTop: 2
              }}
              value={
                (() => {
                  // Nodes with labels
                  const shown = (sidebarTableData?.shownItems || []).map(
                    n => `${n.qid} (${n.label}) ${n.reason.replace('shown ', 's:').replace('shown', 's')}`
                  );
                  const hidden = (sidebarTableData?.hiddenItems || []).map(
                    n => `${n.qid} (${n.label}) h:${n.reason.replace('hidden ', '')}`
                  );
                  // Edges with property labels
                  const edgeLines = (elements || [])
                    .filter(e => e.data && e.data.source && e.data.target)
                    .map(e =>
                      `${e.data.source}->${e.data.target} [${e.data.property || ''}${e.data.propertyLabel ? ' (' + e.data.propertyLabel + ')' : ''}]`
                    );
                  // Unique P ids and their labels
                  const pidLabels = {};
                  (elements || []).forEach(e => {
                    if (e.data && e.data.property) {
                      pidLabels[e.data.property] = e.data.propertyLabel || e.data.property;
                    }
                  });
                  const pidLabelLines = Object.entries(pidLabels).map(
                    ([pid, label]) => `${pid}: ${label}`
                  );
                  return [
                    '# Nodes:',
                    ...shown,
                    ...hidden,
                    '# Edges:',
                    ...edgeLines,
                    '# Property labels:',
                    ...pidLabelLines
                  ].join('\n');
                })()
              }
            />
          </div>
        </div>
        {/* Resizer handle */}
        <div
          className="sidebar-resizer"
          onMouseDown={e => { e.preventDefault(); setIsResizing(true); }}
          style={{
            cursor: 'col-resize',
            width: 6,
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: 12,
            background: isResizing ? '#b3d4fc' : 'transparent',
            transition: 'background 0.2s'
          }}
        />
      </Sidebar>
      {/* Main graph area */}
      <div className="main-content">
        {graphType === 'cytoscape' ? (
          <CytoscapeComponent
            key={layoutKey}
            elements={elements}
            layout={React.useMemo(() => getLayout(elements), [elements, layoutKey])}
            stylesheet={React.useMemo(() => getStylesheet(showImages, nodeSize), [showImages, nodeSize])}
            style={{ width: '100%', height: '100%', background: '#fafafa' }}
            cy={(cy) => {
              cyRef.current = cy;
              // Apply stylesheet changes without layout recalculation
              if (cy && elements.length > 0) {
                cy.style(getStylesheet(showImages, nodeSize));
              }
            }}
          />
        ) : (
          <ReactFlowGraph elements={elements} showImages={showImages} />
        )}
      </div>
    </div>
  );
}

export default App;
