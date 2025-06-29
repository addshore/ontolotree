import CytoscapeComponent from 'react-cytoscapejs';
import './App.css';

const elements = [
  // Nodes with images
  { data: { id: 'heterotroph', label: 'heterotroph', img: 'https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/documentation/demos/images-breadthfirst-layout/galaxy.png' } },
  { data: { id: 'physical object', label: 'physical object', img: 'https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/documentation/demos/images-breadthfirst-layout/earth.png' } },
  { data: { id: 'organism', label: 'organism', img: 'https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/documentation/demos/images-breadthfirst-layout/tree.png' } },
  { data: { id: 'animal', label: 'animal', img: 'https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/documentation/demos/images-breadthfirst-layout/cat.png' } },
  { data: { id: 'dog', label: 'dog', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/20110425_German_Shepherd_Dog_8505.jpg/330px-20110425_German_Shepherd_Dog_8505.jpg' } },
  { data: { id: 'bulldog', label: 'bulldog', img: 'https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/documentation/demos/images-breadthfirst-layout/bulldog.png' } },
  { data: { id: 'chiwahwa', label: 'chiwahwa', img: 'https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/documentation/demos/images-breadthfirst-layout/chihuahua.png' } },
  { data: { id: 'dalmation', label: 'dalmation', img: 'https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/documentation/demos/images-breadthfirst-layout/dalmatian.png' } },
  { data: { id: 'husky', label: 'husky', img: 'https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/documentation/demos/images-breadthfirst-layout/husky.png' } },
  // Edges
  { data: { source: 'heterotroph', target: 'physical object' } },
  { data: { source: 'physical object', target: 'organism' } },
  { data: { source: 'organism', target: 'animal' } },
  { data: { source: 'animal', target: 'dog' } },
  { data: { source: 'dog', target: 'bulldog' } },
  { data: { source: 'dog', target: 'chiwahwa' } },
  { data: { source: 'dog', target: 'dalmation' } },
  { data: { source: 'dog', target: 'husky' } },
];

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
    selector: 'node',
    style: {
      'background-fit': 'cover',
      'background-image': 'data(img)',
      'background-color': '#fff',
      'label': 'data(label)', // Show label
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 10,
      'color': '#111',
      'font-size': 18,
      'font-weight': 'normal',
      'width': ele => ele.data('id') === 'dog' ? 120 : 80,
      'height': ele => ele.data('id') === 'dog' ? 120 : 80,
      'border-width': 6,
      'border-color': ele => ele.data('id') === 'dog' ? '#ff6600' : '#888',
      'shadow-blur': 12,
      'shadow-color': '#888',
      'shadow-offset-x': 0,
      'shadow-offset-y': 2,
      'shadow-opacity': 0.4,
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
  return (
    <div className="App" style={{ width: '100vw', height: '100vh', margin: 0, padding: 0, background: '#fafafa' }}>
      <CytoscapeComponent
        elements={elements}
        layout={layout}
        stylesheet={stylesheet}
        style={{ width: '100vw', height: '100vh', background: '#fafafa' }}
      />
    </div>
  );
}

export default App;
