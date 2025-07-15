import React, { useMemo, useEffect } from 'react';
import ReactFlow, { Background, Controls, MiniMap, Handle, Position, useReactFlow, ReactFlowProvider } from 'reactflow';
import 'reactflow/dist/style.css';

// Custom node with optional image
function ImageNode({ data }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '2px solid #888',
        borderRadius: 8,
        padding: 6,
        minWidth: 100,
        minHeight: 100,
        textAlign: 'center',
        boxShadow: '0 2px 8px #0001',
        position: 'relative'
      }}
    >
      {data.showImages && data.img && (
        <img
          src={data.img}
          alt={data.label}
          style={{
            width: 60,
            height: 60,
            objectFit: 'cover',
            borderRadius: 6,
            marginBottom: 4,
            background: '#eee'
          }}
        />
      )}
      <div style={{ fontSize: 13, fontWeight: 500, wordBreak: 'break-word', whiteSpace: 'pre-line' }}>
        {data.label}
      </div>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

/**
 * Convert Cytoscape elements to React Flow nodes and edges,
 * and arrange nodes in a simple vertical tree layout.
 */
function convertElementsToReactFlow(elements, showImages) {
  const nodes = [];
  const edges = [];
  const nodeMap = {};
  const childrenMap = {};
  const parentCount = {};

  // First pass: collect nodes and edges, build maps
  elements.forEach(el => {
    if (el.data && el.data.id && !el.data.source && !el.data.target) {
      nodeMap[el.data.id] = {
        ...el,
        children: [],
      };
      parentCount[el.data.id] = 0;
    } else if (el.data && el.data.source && el.data.target) {
      edges.push({
        id: `${el.data.source}-${el.data.target}`,
        source: el.data.source,
        target: el.data.target,
        label: el.data.propertyLabel || el.data.property,
        animated: true,
        style: { stroke: '#888' },
      });
      // Build children/parent maps
      if (!childrenMap[el.data.source]) childrenMap[el.data.source] = [];
      childrenMap[el.data.source].push(el.data.target);
      parentCount[el.data.target] = (parentCount[el.data.target] || 0) + 1;
    }
  });

  // Identify root nodes (no parents)
  const roots = Object.keys(nodeMap).filter(id => parentCount[id] === 0);

  // Improved: assign level as one more than the minimum level of all parents (topological propagation)
  const levelMap = {};
  const nodesByLevel = {};
  let maxLevel = 0;

  // Build parent map for each node
  const parentMap = {};
  edges.forEach(e => {
    if (!parentMap[e.target]) parentMap[e.target] = [];
    parentMap[e.target].push(e.source);
  });

  roots.forEach(rootId => {
    levelMap[rootId] = 0;
  });

  // Propagate levels: for each node, level = min(parent levels) + 1
  let changed = true;
  while (changed) {
    changed = false;
    Object.keys(nodeMap).forEach(id => {
      if (roots.includes(id)) return;
      const parents = parentMap[id] || [];
      if (parents.length === 0) return;
      const minParentLevel = Math.min(...parents.map(pid => levelMap[pid] !== undefined ? levelMap[pid] : Infinity));
      const newLevel = minParentLevel + 1;
      if (levelMap[id] === undefined || newLevel < levelMap[id]) {
        levelMap[id] = newLevel;
        changed = true;
      }
    });
  }

  // Build nodesByLevel and find maxLevel
  Object.entries(levelMap).forEach(([id, lvl]) => {
    nodesByLevel[lvl] = nodesByLevel[lvl] || [];
    nodesByLevel[lvl].push(id);
    if (lvl > maxLevel) maxLevel = lvl;
  });

  // Spread nodes evenly across each level, dynamically expanding width
  const nodeSpacingY = 140;
  const nodeWidth = 120;
  const minSpacing = 40;

  for (let level = 0; level <= maxLevel; level++) {
    const ids = nodesByLevel[level] || [];
    const total = ids.length;
    const spacingX = total > 1 ? nodeWidth + minSpacing : 0;
    const levelWidth = total > 1 ? (total - 1) * spacingX : nodeWidth;
    ids.forEach((id, i) => {
      const x = total === 1 ? 0 : -levelWidth / 2 + i * spacingX;
      const y = level * nodeSpacingY;
      nodes.push({
        id,
        type: 'imageNode',
        data: {
          label: nodeMap[id]?.data?.label || id,
          img: nodeMap[id]?.data?.img,
          showImages,
        },
        position: { x, y },
        style: {
          width: nodeMap[id]?.data?.width || nodeWidth,
          height: nodeMap[id]?.data?.height || 100,
        },
      });
    });
  }

  return { nodes, edges };
}

export default function ReactFlowGraph({ elements, showImages, showFitButton }) {
  const nodeTypes = useMemo(() => ({ imageNode: ImageNode }), []);
  const { nodes, edges } = useMemo(
    () => convertElementsToReactFlow(elements, showImages),
    [elements, showImages]
  );

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlowProvider>
        <InnerReactFlowGraph
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          showFitButton={showFitButton}
        />
      </ReactFlowProvider>
    </div>
  );
}

function InnerReactFlowGraph({ nodes, edges, nodeTypes, showFitButton }) {
  const reactFlowInstance = useReactFlow();

  // Fit to screen on first render or when nodes/edges change
  useEffect(() => {
    if (nodes.length > 0) {
      reactFlowInstance.fitView();
    }
    // eslint-disable-next-line
  }, [nodes, edges]);

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
      >
        <MiniMap nodeColor={n => (n.data && n.data.img ? '#7ecbff' : '#bbb')} />
        <Controls />
        <Background />
      </ReactFlow>
      {showFitButton && (
        <button
          onClick={() => reactFlowInstance.fitView()}
          style={{
            position: 'absolute',
            bottom: 24,
            right: 24,
            zIndex: 20,
            padding: '10px 18px',
            borderRadius: 8,
            border: 'none',
            background: '#0074D9',
            color: '#fff',
            fontWeight: 600,
            fontSize: 16,
            boxShadow: '0 2px 8px #0002',
            cursor: 'pointer'
          }}
          title="Fit graph to screen"
        >
          Fit to Screen
        </button>
      )}
    </>
  );
}