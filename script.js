import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// --- CONFIGURATION ---
const CONFIG = {
    colors: {
        R: 0xdc143c,      // Realistic red (slightly brighter)
        L: 0xff6600,      // Realistic orange
        U: 0xffffff,       // White
        D: 0xffd700,       // Realistic yellow (slightly warmer)
        F: 0x00a651,      // Realistic green (slightly brighter)
        B: 0x0066cc,       // Realistic blue
        CORE: 0x0a0a0a    // Deep black for plastic
    },
    spacing: 1.08, // Increased spacing for realistic gaps between cubelets
    cubeletSize: 0.92, // Slightly smaller cubelets to show gaps (like real Rubik's cube)
    animSpeed: 0.25
};

// --- STATE ---
const STATE = {
    order: 3,
    type: 'normal',
    isAnimating: false,
    memoryStack: [],
    isSolving: false
};

// --- GLOBALS ---
let scene, camera, renderer, controls;
let allCubelets = [];
const moveQueue = [];
let pivot = new THREE.Object3D(); 
let logicCube = null;

// --- INITIALIZATION ---
function init() {
    const container = document.getElementById('viewport');
    
    scene = new THREE.Scene();
    // Grey background for realistic look
    scene.background = new THREE.Color(0x2a2a2a);
    scene.add(pivot);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 100);
    camera.position.set(6, 6, 8);
    camera.lookAt(0,0,0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Enhanced lighting setup for realistic look
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(10, 15, 8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left = -10;
    dirLight.shadow.camera.right = 10;
    dirLight.shadow.camera.top = 10;
    dirLight.shadow.camera.bottom = -10;
    scene.add(dirLight);

    // Fill light from opposite side
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-8, 5, -5);
    scene.add(fillLight);

    // Ambient light for overall illumination
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // Add ground plane for hover effect (positioned below cube)
    const groundGeometry = new THREE.PlaneGeometry(40, 40);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x1a1a1a,
        roughness: 0.9,
        metalness: 0.05
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -5; // Closer to cube for better hover effect
    ground.receiveShadow = true;
    scene.add(ground);

    // Add subtle gradient background effect
    const gradientGeometry = new THREE.PlaneGeometry(100, 100);
    const gradientMaterial = new THREE.MeshBasicMaterial({ 
        color: 0x2a2a2a,
        side: THREE.DoubleSide
    });
    const gradientPlane = new THREE.Mesh(gradientGeometry, gradientMaterial);
    gradientPlane.rotation.x = -Math.PI / 2;
    gradientPlane.position.y = -6;
    scene.add(gradientPlane);

    buildPuzzle(3, 'normal');
    
    renderer.setAnimationLoop(animate);
    setupUI();
}

// --- LOGIC ENGINE ---
class VirtualCube {
    constructor(order, type) {
        this.pieces = [];
        const offset = (order - 1) / 2;
        
        for (let x = 0; x < order; x++) {
            for (let y = 0; y < order; y++) {
                for (let z = 0; z < order; z++) {
                    this.pieces.push({
                        // Integers
                        x: x - offset, y: y - offset, z: z - offset,
                        // Vectors
                        u: new THREE.Vector3(0, 1, 0),
                        f: new THREE.Vector3(0, 0, 1),
                        // ID
                        ox: x - offset, oy: y - offset, oz: z - offset,
                        isCenter: (Math.abs(x-offset)+Math.abs(y-offset)+Math.abs(z-offset) === 1),
                        // Visual
                        mesh: null
                    });
                }
            }
        }
    }

    rotateLogic(axis, slice, dir) {
        const eps = 0.1;
        const axisVec = new THREE.Vector3();
        axisVec[axis] = 1;

        this.pieces.forEach(p => {
            if (Math.abs(p[axis] - slice) < eps) {
                const pos = new THREE.Vector3(p.x, p.y, p.z);
                pos.applyAxisAngle(axisVec, dir * (Math.PI / 2));
                
                p.x = Math.round(pos.x * 2) / 2;
                p.y = Math.round(pos.y * 2) / 2;
                p.z = Math.round(pos.z * 2) / 2;

                p.u.applyAxisAngle(axisVec, dir * (Math.PI / 2));
                p.f.applyAxisAngle(axisVec, dir * (Math.PI / 2));
                
                p.u.x = Math.round(p.u.x); p.u.y = Math.round(p.u.y); p.u.z = Math.round(p.u.z);
                p.f.x = Math.round(p.f.x); p.f.y = Math.round(p.f.y); p.f.z = Math.round(p.f.z);
            }
        });
    }

    forceReset() {
        this.pieces.forEach(p => {
            p.x = p.ox; p.y = p.oy; p.z = p.oz;
            p.u.set(0, 1, 0);
            p.f.set(0, 0, 1);
        });
    }
}

function buildPuzzle(order, type) {
    STATE.order = order;
    STATE.type = type;
    STATE.memoryStack = [];
    updateUI();

    pivot.rotation.set(0,0,0);
    while(pivot.children.length) scene.attach(pivot.children[0]);

    allCubelets.forEach(m => {
        scene.remove(m);
        if(m.geometry) m.geometry.dispose();
    });
    allCubelets = [];

    logicCube = new VirtualCube(order, type);
    
    // Create realistic beveled cube geometry with rounded edges
    const createRealisticCubelet = () => {
        const size = CONFIG.cubeletSize;
        const radius = 0.08; // Radius for rounded corners (realistic bevel)
        const segments = 3; // Number of segments for smooth rounded edges
        
        // Use RoundedBoxGeometry for realistic beveled edges
        return new RoundedBoxGeometry(size, size, size, segments, radius);
    };
    
    logicCube.pieces.forEach(p => {
        const ox = p.ox, oy = p.oy, oz = p.oz;
        const offset = (order - 1) / 2;

        // Create realistic black plastic material for cube body
        const plasticMaterial = new THREE.MeshStandardMaterial({
            color: 0x0a0a0a, // Deep black plastic like real Rubik's cube
            roughness: 0.7,  // Semi-matte finish (realistic plastic)
            metalness: 0.0,
            flatShading: false
        });

        // Create realistic sticker materials - vibrant colors with glossy finish
        const createStickerMaterial = (color) => {
            return new THREE.MeshStandardMaterial({
                color: color,
                roughness: 0.15,  // Glossy sticker finish (like real vinyl stickers)
                metalness: 0.0,
                flatShading: false
            });
        };

        // Determine which faces have colored stickers
        const hasStickerRight = ox === offset;
        const hasStickerLeft = ox === -offset;
        const hasStickerTop = oy === offset;
        const hasStickerBottom = oy === -offset;
        const hasStickerFront = oz === offset;
        const hasStickerBack = oz === -offset;

        // Create materials array: [Right, Left, Top, Bottom, Front, Back]
        const materials = [
            hasStickerRight ? createStickerMaterial(CONFIG.colors.R) : plasticMaterial.clone(),
            hasStickerLeft ? createStickerMaterial(CONFIG.colors.L) : plasticMaterial.clone(),
            hasStickerTop ? createStickerMaterial(CONFIG.colors.U) : plasticMaterial.clone(),
            hasStickerBottom ? createStickerMaterial(CONFIG.colors.D) : plasticMaterial.clone(),
            hasStickerFront ? createStickerMaterial(CONFIG.colors.F) : plasticMaterial.clone(),
            hasStickerBack ? createStickerMaterial(CONFIG.colors.B) : plasticMaterial.clone(),
        ];

        if (type === 'mirror') {
            materials.forEach(m => { 
                m.color.setHex(0x2a2a2a); 
                m.roughness = 0.1;
                m.metalness = 0.5;
            });
        }

        // Create the main cubelet mesh with realistic beveled edges
        const geom = createRealisticCubelet();
        const mesh = new THREE.Mesh(geom, materials);
        
        if (type === 'mirror') mesh.scale.set(1 + ox*0.35, 1 + oy*0.35, 1 + oz*0.35);

        // Add subtle black edge lines for definition (like real cube gaps)
        const edgeGeometry = new THREE.EdgesGeometry(geom);
        const edgeMaterial = new THREE.LineBasicMaterial({ 
            color: 0x000000,
            linewidth: 1.5
        });
        const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        mesh.add(edges);

        // Enable shadows for realistic depth and lighting
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        p.mesh = mesh;
        scene.add(mesh);
        allCubelets.push(mesh);
    });

    forceVisualSync();
}

// --- VISUAL SYNC (THE FIX) ---
// This function ensures the mesh is NEVER stuck on a tilted pivot.
function forceVisualSync() {
    // 1. NUCLEAR DETACH: Force everything off the pivot into World Space
    while(pivot.children.length > 0) {
        scene.attach(pivot.children[0]);
    }
    
    // 2. Reset Pivot to Neutral
    pivot.rotation.set(0, 0, 0);
    pivot.position.set(0, 0, 0);
    pivot.updateMatrixWorld();

    // 3. Teleport Meshes to Logic Grid
    const spacing = (STATE.type === 'mirror') ? 1.4 : CONFIG.spacing;
    
    logicCube.pieces.forEach(p => {
        const m = p.mesh;
        m.position.set(p.x * spacing, p.y * spacing, p.z * spacing);
        
        const mat = new THREE.Matrix4();
        const right = new THREE.Vector3().crossVectors(p.u, p.f).normalize();
        mat.makeBasis(right, p.u, p.f);
        m.quaternion.setFromRotationMatrix(mat);
        
        m.updateMatrix();
        m.updateMatrixWorld();
    });
}

// --- ANIMATION ---
let currentMove = null;
let progress = 0;
let lastTime = 0;
const ANIMATION_DURATION = 0.4; // seconds per rotation

// Smooth easing functions
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function processQueue() {
    if (!moveQueue.length) {
        if (STATE.isAnimating) {
            STATE.isAnimating = false;
            document.getElementById('ai-state').innerText = "IDLE";
            document.getElementById('ai-state').style.color = "#666";
            
            forceVisualSync();
            validateAndHeal();
        }
        return;
    }

    const currentTime = performance.now() / 1000; // Convert to seconds
    const deltaTime = lastTime ? currentTime - lastTime : 0.016; // Default to ~60fps if first frame
    lastTime = currentTime;

    if (!currentMove) {
        forceVisualSync();
        
        currentMove = moveQueue.shift();
        STATE.isAnimating = true;
        progress = 0;
        lastTime = currentTime;
        document.getElementById('ai-state').innerText = "MOVING";
        document.getElementById('ai-state').style.color = "#00ff88";

        const eps = 0.1;
        const group = logicCube.pieces.filter(p => 
            Math.abs(p[currentMove.axis] - currentMove.slice) < eps
        );

        pivot.rotation.set(0,0,0);
        pivot.updateMatrixWorld();
        group.forEach(p => pivot.attach(p.mesh));
    }

    // Calculate speed multiplier based on CONFIG.animSpeed
    // animSpeed 0.25 = normal speed, higher = faster
    // Map slider value (1-20) to speed multiplier (0.1x to 10x)
    const speedMultiplier = Math.max(0.1, CONFIG.animSpeed / 0.25);
    const adjustedDuration = ANIMATION_DURATION / speedMultiplier;
    
    // Update progress based on deltaTime for smooth frame-rate independent animation
    progress += deltaTime / adjustedDuration;
    
    // Clamp progress
    if (progress >= 1.0) progress = 1.0;

    if (progress >= 1.0) {
        // Finish Move
        const axisVec = new THREE.Vector3();
        axisVec[currentMove.axis] = 1;
        pivot.quaternion.setFromAxisAngle(axisVec, currentMove.dir * (Math.PI / 2));
        pivot.updateMatrixWorld();

        logicCube.rotateLogic(currentMove.axis, currentMove.slice, currentMove.dir);
        
        // This function now handles the cleanup safely
        forceVisualSync();

        currentMove = null;
        progress = 0;
    } else {
        // Animate Move with smooth easing
        const axisVec = new THREE.Vector3();
        axisVec[currentMove.axis] = 1;
        
        // Apply easing for smooth acceleration and deceleration
        const easedProgress = easeInOutCubic(progress);
        const rotationAngle = currentMove.dir * easedProgress * (Math.PI / 2);
        
        pivot.rotation.set(0,0,0);
        pivot.rotateOnAxis(axisVec, rotationAngle);
    }
}

// --- HEALER ---
function validateAndHeal() {
    if (STATE.isSolving && STATE.memoryStack.length === 0) {
        let isBroken = false;
        const faces = [{ax:'x',v:1},{ax:'x',v:-1},{ax:'y',v:1},{ax:'y',v:-1},{ax:'z',v:1},{ax:'z',v:-1}];

        for(let f of faces) {
            const onFace = logicCube.pieces.filter(p => Math.abs(p[f.ax] - f.v) < 0.1);
            const oxSet = new Set(onFace.map(p => p.ox));
            const oySet = new Set(onFace.map(p => p.oy));
            const ozSet = new Set(onFace.map(p => p.oz));
            const solved = (oxSet.size===1 && Math.abs([...oxSet][0])===1) || 
                           (oySet.size===1 && Math.abs([...oySet][0])===1) || 
                           (ozSet.size===1 && Math.abs([...ozSet][0])===1);
            if(!solved) isBroken = true;
        }

        if (isBroken) {
            log("AI: Integrity Failed. Resetting to solved state.");
            logicCube.forceReset();
            forceVisualSync();
            STATE.isSolving = false;
            document.getElementById('ai-state').innerText = "REPAIRED";
            document.getElementById('ai-state').style.color = "#00ff88";
        } else {
            checkAndFixAlignment();
        }
    }
}

function checkAndFixAlignment() {
    if (STATE.memoryStack.length > 0) return;

    const topPiece = logicCube.pieces.find(p => p.oy === 1 && p.isCenter);
    if(topPiece) {
        if(Math.abs(topPiece.u.y - 1) > 0.1) {
            log("AI: Aligning Orientation...");
            moveQueue.push({ axis: 'x', slice: 0, dir: 1 });
            moveQueue.push({ axis: 'x', slice: 1, dir: 1 });
            moveQueue.push({ axis: 'x', slice: -1, dir: 1 });
            return;
        }
    }
    const frontPiece = logicCube.pieces.find(p => p.oz === 1 && p.isCenter);
    if(frontPiece) {
        if(Math.abs(frontPiece.f.z - 1) > 0.1) {
            log("AI: Aligning Front...");
            moveQueue.push({ axis: 'y', slice: 0, dir: 1 });
            moveQueue.push({ axis: 'y', slice: 1, dir: 1 });
            moveQueue.push({ axis: 'y', slice: -1, dir: 1 });
            return;
        }
    }
    
    STATE.isSolving = false;
    document.getElementById('ai-state').innerText = "SOLVED";
    document.getElementById('ai-state').style.color = "#00ff88";
}

// --- CONTROLS ---

function scramble() {
    if (STATE.isAnimating) return;
    if (moveQueue.length > 0) return;

    STATE.isSolving = false;
    const moves = 20;
    const axes = ['x','y','z'];
    const range = (STATE.order - 1) / 2;
    const slices = [];
    for(let i = -range; i <= range; i++) slices.push(i);

    log("Scramble Initiated");
    for(let i=0; i<moves; i++) {
        const m = {
            axis: axes[Math.floor(Math.random()*3)],
            slice: slices[Math.floor(Math.random()*slices.length)],
            dir: Math.random() > 0.5 ? 1 : -1
        };
        moveQueue.push(m);
        STATE.memoryStack.push(m);
    }
    updateUI();
}

function solve() {
    if (STATE.isAnimating || !STATE.memoryStack.length) return;
    STATE.isSolving = true;
    log("AI: Solving...");
    const sol = STATE.memoryStack.slice().reverse().map(m => ({
        axis: m.axis,
        slice: m.slice,
        dir: m.dir * -1
    }));
    sol.forEach(m => moveQueue.push(m));
    STATE.memoryStack = [];
    updateUI();
}

function updateUI() {
    document.getElementById('stack-count').innerText = STATE.memoryStack.length;
}
function log(msg) {
    const d = document.createElement('div');
    d.innerHTML = `> ${msg}`;
    document.getElementById('console-log').prepend(d);
}
function setupUI() {
    document.getElementById('btn-scramble').addEventListener('click', scramble);
    document.getElementById('btn-solve').addEventListener('click', solve);
    document.getElementById('speed-slider').addEventListener('input', e => {
        let val = parseInt(e.target.value);
        document.getElementById('speed-val').innerText = val;
        // Aggressive turbo mapping: 1 = very slow, 10 = fast, 20 = ultra fast
        // We scale animSpeed so high values drastically shorten the move duration
        CONFIG.animSpeed = 0.1 * val; // val=20 -> animSpeed=2.0 (8x baseline)
    });
    document.getElementById('puzzle-type').addEventListener('change', e => {
        const val = e.target.value;
        if(val === 'mirror') buildPuzzle(3, 'mirror');
        else buildPuzzle(parseInt(val), 'normal');
    });
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth/window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}
function animate() {
    controls.update();
    processQueue();
    renderer.render(scene, camera);
}

init();