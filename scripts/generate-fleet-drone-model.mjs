import { Buffer } from 'node:buffer';

const materials = [
  { name: 'graphite body', base: [0.075, 0.11, 0.14, 1], metallic: 0.55, roughness: 0.42 },
  { name: 'ceramic shell', base: [0.72, 0.86, 0.9, 1], metallic: 0.22, roughness: 0.34 },
  { name: 'cyan trim', base: [0.08, 0.64, 0.76, 1], metallic: 0.35, roughness: 0.28 },
  { name: 'mission orange', base: [1, 0.36, 0.08, 1], metallic: 0.12, roughness: 0.38 },
  { name: 'rotor carbon', base: [0.012, 0.025, 0.035, 1], metallic: 0.2, roughness: 0.62 },
  { name: 'sensor glass', base: [0.08, 0.78, 0.86, 1], metallic: 0.08, roughness: 0.18 },
];

const meshes = [];
const nodes = [];

function addMesh(name, positions, indices, material) {
  const id = meshes.length;
  meshes.push({ name, positions, indices, material });
  return id;
}

function box(name, sx, sy, sz, material) {
  const x = sx / 2;
  const y = sy / 2;
  const z = sz / 2;
  const positions = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
  ].flat();
  const indices = [
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3, 4, 0, 3, 4, 3, 7,
  ];
  return addMesh(name, positions, indices, material);
}

function hull(name, material) {
  const sections = [
    { y: -0.68, w: 0.42, z: 0.18 },
    { y: 0.25, w: 0.38, z: 0.19 },
    { y: 0.72, w: 0.22, z: 0.12 },
    { y: 0.88, w: 0.06, z: 0.06 },
  ];
  const positions = [];
  sections.forEach((section) => positions.push(
    -section.w, section.y, -section.z,
    section.w, section.y, -section.z,
    section.w, section.y, section.z,
    -section.w, section.y, section.z,
  ));
  const indices = [];
  for (let index = 0; index < sections.length - 1; index += 1) {
    const a = index * 4;
    const b = (index + 1) * 4;
    indices.push(
      a, a + 1, b + 1, a, b + 1, b,
      a + 3, b + 3, b + 2, a + 3, b + 2, a + 2,
    );
  }
  indices.push(0, 3, 2, 0, 2, 1, 12, 13, 14, 12, 14, 15);
  return addMesh(name, positions, indices, material);
}

function cylinder(name, radius, height, material, segments = 10) {
  const positions = [];
  const z0 = -height / 2;
  const z1 = height / 2;
  for (let index = 0; index < segments; index += 1) {
    const angle = index * 2 * Math.PI / segments;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, z0);
  }
  for (let index = 0; index < segments; index += 1) {
    const angle = index * 2 * Math.PI / segments;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, z1);
  }
  positions.push(0, 0, z0, 0, 0, z1);
  const bottom = segments * 2;
  const top = bottom + 1;
  const indices = [];
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    indices.push(
      index, next, segments + next,
      index, segments + next, segments + index,
      index, bottom, next,
      top, segments + next, segments + index,
    );
  }
  return addMesh(name, positions, indices, material);
}

function rotor(name, material) {
  const positions = [
    -0.055, -0.58, 0, 0.055, -0.58, 0, 0.09, -0.08, 0, -0.09, -0.08, 0,
    0.055, 0.58, 0, -0.055, 0.58, 0, -0.09, 0.08, 0, 0.09, 0.08, 0,
  ];
  return addMesh(name, positions, [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7], material);
}

function dome(name, material, segments = 10, rings = 4) {
  const positions = [];
  const indices = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (Math.PI / 2) * (ring / rings);
    const radius = Math.sin(phi) * 0.5;
    const z = Math.cos(phi) * 0.5;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = 2 * Math.PI * segment / segments;
      positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = ring * segments + segment;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + next;
      const d = (ring + 1) * segments + segment;
      indices.push(a, b, c, a, c, d);
    }
  }
  return addMesh(name, positions, indices, material);
}

function zRotation(degrees) {
  const angle = degrees * Math.PI / 360;
  return [0, 0, Math.sin(angle), Math.cos(angle)];
}

function xRotation(degrees) {
  const angle = degrees * Math.PI / 360;
  return [Math.sin(angle), 0, 0, Math.cos(angle)];
}

function addNode(name, mesh, props = {}) {
  nodes.push({ name, mesh, ...props });
}

const body = hull('faceted fuselage', 0);
const top = box('top armor', 0.48, 0.86, 0.08, 1);
const arm = box('carbon arm', 1.9, 0.11, 0.075, 2);
const motor = cylinder('motor pod', 0.13, 0.13, 0, 10);
const hub = cylinder('rotor hub', 0.065, 0.09, 3, 10);
const blades = rotor('two blade rotor', 4);
const leg = box('landing leg', 0.055, 0.055, 0.3, 0);
const skid = box('landing skid', 0.055, 0.34, 0.055, 2);
const sensor = dome('camera dome', 5, 10, 4);
const lens = box('camera lens', 0.12, 0.055, 0.08, 3);
const nose = box('nose marker', 0.23, 0.08, 0.045, 3);
const mast = cylinder('top mast', 0.025, 0.16, 2, 8);

addNode('fuselage', body);
addNode('top armor', top, { translation: [0, 0.02, 0.21] });
addNode('diagonal arm front-left to rear-right', arm, { translation: [0, 0, 0.03], rotation: zRotation(45) });
addNode('diagonal arm front-right to rear-left', arm, { translation: [0, 0, 0.03], rotation: zRotation(-45) });

for (const [x, y, label] of [
  [-0.88, 0.88, 'front-left'],
  [0.88, 0.88, 'front-right'],
  [-0.88, -0.88, 'rear-left'],
  [0.88, -0.88, 'rear-right'],
]) {
  addNode(`motor ${label}`, motor, { translation: [x, y, 0.09] });
  addNode(`rotor hub ${label}`, hub, { translation: [x, y, 0.19] });
  addNode(`rotor blades ${label}`, blades, {
    translation: [x, y, 0.245],
    rotation: zRotation(label.includes('left') ? 18 : -18),
  });
  addNode(`landing leg ${label}`, leg, { translation: [x * 0.58, y * 0.58, -0.21] });
}

addNode('left landing skid', skid, { translation: [-0.5, 0, -0.37] });
addNode('right landing skid', skid, { translation: [0.5, 0, -0.37] });
addNode('camera dome', sensor, { translation: [0, 0.7, -0.16], scale: [0.34, 0.34, 0.34] });
addNode('camera lens', lens, { translation: [0, 0.91, -0.16] });
addNode('nose direction marker', nose, { translation: [0, 0.82, 0.24] });
addNode('top mast', mast, { translation: [0, -0.42, 0.32] });

// Keep the landing skids just above the model origin. Cesium can then use the
// origin as the ground-relative reference without burying the airframe in
// photogrammetry terrain when a demo drone is parked at altitude 0.
const groundClearance = 0.42;
nodes.forEach((node) => {
  const [x = 0, y = 0, z = 0] = node.translation || [];
  node.translation = [x, y, z + groundClearance];
});

// The procedural helpers use the more convenient Z-up convention. GLTF is
// Y-up, so keep the conversion in one root node instead of baking it into
// every primitive and losing the readable local drone coordinates above.
const airframeChildren = nodes.map((_, index) => index);
nodes.push({
  name: 'airframe Z-up to GLTF Y-up',
  children: airframeChildren,
  rotation: xRotation(-90),
});

const bufferViews = [];
const accessors = [];
const bytes = [];

function alignTo(alignment) {
  while (bytes.length % alignment) bytes.push(0);
}

function append(typedArray) {
  alignTo(4);
  const offset = bytes.length;
  const data = Buffer.from(new Uint8Array(typedArray.buffer));
  for (const byte of data) bytes.push(byte);
  return { offset, length: data.length };
}

for (const mesh of meshes) {
  const positionBuffer = append(new Float32Array(mesh.positions));
  const indexBuffer = append(new Uint16Array(mesh.indices));
  const positionView = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset: positionBuffer.offset, byteLength: positionBuffer.length, target: 34962 });
  const indexView = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset: indexBuffer.offset, byteLength: indexBuffer.length, target: 34963 });
  const xs = [];
  const ys = [];
  const zs = [];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    xs.push(mesh.positions[index]);
    ys.push(mesh.positions[index + 1]);
    zs.push(mesh.positions[index + 2]);
  }
  accessors.push({
    bufferView: positionView,
    componentType: 5126,
    count: mesh.positions.length / 3,
    type: 'VEC3',
    min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
    max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
  });
  accessors.push({ bufferView: indexView, componentType: 5123, count: mesh.indices.length, type: 'SCALAR' });
  mesh.positionAccessor = accessors.length - 2;
  mesh.indexAccessor = accessors.length - 1;
}

const binary = Buffer.from(bytes).toString('base64');
const model = {
  asset: { version: '2.0', generator: 'drone-navigation faceted reconnaissance quadcopter' },
  extensionsUsed: ['KHR_materials_unlit'],
  scene: 0,
  scenes: [{ nodes: [nodes.length - 1] }],
  nodes,
  meshes: meshes.map((mesh) => ({
    name: mesh.name,
    primitives: [{ attributes: { POSITION: mesh.positionAccessor }, indices: mesh.indexAccessor, material: mesh.material }],
  })),
  materials: materials.map((material) => ({
    name: material.name,
    pbrMetallicRoughness: {
      baseColorFactor: material.base,
      metallicFactor: material.metallic,
      roughnessFactor: material.roughness,
    },
    extensions: { KHR_materials_unlit: {} },
  })),
  accessors,
  bufferViews,
  buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${binary}` }],
};

process.stdout.write(`${JSON.stringify(model, null, 2)}\n`);
