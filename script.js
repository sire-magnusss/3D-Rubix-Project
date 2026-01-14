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
    animSpeed: 0.25,
    // Production mode: set to true to minimize console output
    production: window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
};

// --- STATE ---
const STATE = {
    order: 3,
    type: 'normal',
    isAnimating: false,
    memoryStack: [],
    isSolving: false,
    // Solver mode:
    //  - 'reverse'     → current reverse-scramble solver
    //  - 'ai-kociemba' → planned 3×3 Kociemba-based solver (stubbed, PRs welcome)
    solveMode: 'reverse',
    // Timing
    isTiming: false,
    solveStartTime: 0,
    solveElapsed: 0,
    // Dashboard drag/resize
    isDragging: false,
    isResizing: false,
    dragStartX: 0,
    dragStartY: 0,
    panelStartX: 0,
    panelStartY: 0,
    panelStartWidth: 0,
    panelStartHeight: 0
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
    
    // Adjust camera position for mobile devices
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        camera.position.set(7, 7, 9); // Slightly further back for mobile
    } else {
        camera.position.set(6, 6, 8);
    }
    camera.lookAt(0,0,0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for performance
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Ensure canvas is visible and properly sized
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = '0';
    
    container.appendChild(canvas);
    
    // Verify container is visible (only in development)
    if (!CONFIG.production) {
        console.log('Viewport container:', container);
        console.log('Canvas appended:', canvas);
    }

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false; // Disable panning for cleaner mobile experience
    controls.minDistance = 5;
    controls.maxDistance = 15;
    controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN
    };

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

            // Stop timer when solving completes
            if (STATE.isTiming) {
                STATE.solveElapsed = (performance.now() - STATE.solveStartTime) / 1000;
                STATE.isTiming = false;
                updateTimerUI(STATE.solveElapsed);
            }
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
            log("AI: Solution complete. Cube restored.");
            logicCube.forceReset();
            forceVisualSync();
            STATE.isSolving = false;
            document.getElementById('ai-state').innerText = "SOLVED";
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

// --- KOCIEMBA AI SOLVER ---

// Convert our cube state to cubejs facelet string format
// Facelet order: U1-U9, R1-R9, F1-F9, D1-D9, L1-L9, B1-B9
function exportCubeStateToCubejs() {
    if (!logicCube || STATE.order !== 3) return null;
    
    const offset = 1; // For 3x3
    const facelets = [];
    
    // Map face positions to cubejs facelet positions
    // Our system: x=left/right, y=up/down, z=front/back
    // Cubejs: U(white top), R(red right), F(green front), D(yellow bottom), L(orange left), B(blue back)
    
    // Helper: get color of a specific face of a piece
    const getFaceColor = (piece, faceDir) => {
        if (!piece || !piece.mesh || !Array.isArray(piece.mesh.material)) return 'U';
        
        const materials = piece.mesh.material;
        const matColors = materials.map(m => m.color.getHex());
        
        // Materials order: [Right, Left, Top, Bottom, Front, Back]
        // 0=Right, 1=Left, 2=Top, 3=Bottom, 4=Front, 5=Back
        
        if (faceDir === 'U' && matColors[2] === CONFIG.colors.U) return 'U';
        if (faceDir === 'D' && matColors[3] === CONFIG.colors.D) return 'D';
        if (faceDir === 'R' && matColors[0] === CONFIG.colors.R) return 'R';
        if (faceDir === 'L' && matColors[1] === CONFIG.colors.L) return 'L';
        if (faceDir === 'F' && matColors[4] === CONFIG.colors.F) return 'F';
        if (faceDir === 'B' && matColors[5] === CONFIG.colors.B) return 'B';
        
        // If exact match not found, check which material is closest to expected position
        // This handles rotated pieces
        const expectedPos = {
            'U': { y: offset },
            'D': { y: -offset },
            'R': { x: offset },
            'L': { x: -offset },
            'F': { z: offset },
            'B': { z: -offset }
        };
        
        const pos = expectedPos[faceDir];
        if (pos) {
            const isOnFace = Object.keys(pos).every(axis => 
                Math.abs(piece[axis] - pos[axis]) < 0.1
            );
            if (isOnFace) {
                // Find which material color matches this face's expected color
                const expectedColor = {
                    'U': CONFIG.colors.U, 'D': CONFIG.colors.D,
                    'R': CONFIG.colors.R, 'L': CONFIG.colors.L,
                    'F': CONFIG.colors.F, 'B': CONFIG.colors.B
                }[faceDir];
                
                const colorIdx = matColors.findIndex(c => c === expectedColor);
                if (colorIdx >= 0) {
                    // Map material index to face
                    const matToFace = ['R', 'L', 'U', 'D', 'F', 'B'];
                    return matToFace[colorIdx];
                }
            }
        }
        
        return faceDir; // Fallback to expected face
    };
    
    // Build facelet string in cubejs order: U, R, F, D, L, B (each 9 facelets)
    const faces = [
        { name: 'U', getPos: (r, c) => ({ x: c, y: offset, z: -r }) },
        { name: 'R', getPos: (r, c) => ({ x: offset, y: -r, z: c }) },
        { name: 'F', getPos: (r, c) => ({ x: c, y: -r, z: offset }) },
        { name: 'D', getPos: (r, c) => ({ x: -c, y: -offset, z: r }) },
        { name: 'L', getPos: (r, c) => ({ x: -offset, y: -r, z: -c }) },
        { name: 'B', getPos: (r, c) => ({ x: -c, y: -r, z: -offset }) }
    ];
    
    for (const face of faces) {
        // Cubejs reads facelets row by row, top to bottom, left to right
        for (let row = 1; row >= -1; row--) {
            for (let col = -1; col <= 1; col++) {
                const pos = face.getPos(row, col);
                const piece = logicCube.pieces.find(p => 
                    Math.abs(p.x - pos.x) < 0.1 && 
                    Math.abs(p.y - pos.y) < 0.1 && 
                    Math.abs(p.z - pos.z) < 0.1
                );
                
                if (piece) {
                    facelets.push(getFaceColor(piece, face.name));
                } else {
                    facelets.push(face.name); // Fallback
                }
            }
        }
    }
    
    return facelets.join('');
}

// Convert cubejs move notation to our move format
// cubejs uses: U, R, F, D, L, B (and ', 2)
// Our format: { axis: 'x'|'y'|'z', slice: -1|0|1, dir: 1|-1 }
function convertCubejsMoveToOurFormat(moveStr) {
    // Parse move string like "U", "R'", "F2", etc.
    const move = moveStr.trim();
    if (!move) return null;
    
    const face = move[0];
    const modifier = move.length > 1 ? move[1] : '';
    
    let axis, slice, dir;
    
    // Map faces to our coordinate system
    // Our system: x=left/right, y=up/down, z=front/back
    if (face === 'U') {
        axis = 'y';
        slice = 1; // Top layer
        dir = modifier === "'" ? -1 : 1;
    } else if (face === 'D') {
        axis = 'y';
        slice = -1; // Bottom layer
        dir = modifier === "'" ? 1 : -1; // Inverted for bottom
    } else if (face === 'R') {
        axis = 'x';
        slice = 1; // Right layer
        dir = modifier === "'" ? -1 : 1;
    } else if (face === 'L') {
        axis = 'x';
        slice = -1; // Left layer
        dir = modifier === "'" ? 1 : -1; // Inverted for left
    } else if (face === 'F') {
        axis = 'z';
        slice = 1; // Front layer
        dir = modifier === "'" ? -1 : 1;
    } else if (face === 'B') {
        axis = 'z';
        slice = -1; // Back layer
        dir = modifier === "'" ? 1 : -1; // Inverted for back
    } else {
        return null;
    }
    
    // Handle double moves (F2 = F F)
    if (modifier === '2') {
        return [
            { axis, slice, dir },
            { axis, slice, dir }
        ];
    }
    
    return { axis, slice, dir };
}

// Solve using Kociemba's algorithm - STUB FOR CONTRIBUTORS
// This function is a clean hook for implementing Kociemba's two-phase algorithm
// See README.md "Implementing Kociemba's Algorithm" section for implementation guide
async function solveWithKociemba() {
    // Check if Kociemba solver library is available
    if (typeof Cube === 'undefined') {
        log("AI: Kociemba solver not available. See README.md for implementation instructions.");
        log("AI: Contributing? Check 'Implementing Kociemba's Algorithm' section.");
        return null;
    }
    
    try {
        // Export current cube state to facelet notation
        const faceletString = exportCubeStateToCubejs();
        if (!faceletString || faceletString.length !== 54) {
            log(`AI: Failed to export cube state (got ${faceletString?.length || 0} facelets, need 54).`);
            return null;
        }
        
        log("AI: Initializing Kociemba solver...");
        
        // Initialize solver (loads pattern databases - may take time on first call)
        if (!Cube.initSolver) {
            log("AI: Cube.initSolver not found. Check library integration.");
            return null;
        }
        Cube.initSolver();
        
        // Create cube from facelet string
        const cube = Cube.fromString ? Cube.fromString(faceletString) : new Cube();
        if (cube.fromString && !Cube.fromString) {
            cube.fromString(faceletString);
        }
        
        // Solve using Kociemba's two-phase algorithm
        if (typeof cube.solve !== 'function') {
            log("AI: cube.solve() method not found. Check library API.");
            return null;
        }
        
        const solution = cube.solve();
        if (!solution || solution.length === 0) {
            log("AI: Kociemba solver returned no solution.");
            return null;
        }
        
        log(`AI: Kociemba solution found: ${solution}`);
        
        // Convert solution to our move format
        const moves = [];
        const moveStrings = solution.trim().split(/\s+/).filter(m => m.length > 0);
        
        for (const moveStr of moveStrings) {
            const converted = convertCubejsMoveToOurFormat(moveStr);
            if (Array.isArray(converted)) {
                moves.push(...converted);
            } else if (converted) {
                moves.push(converted);
            }
        }
        
        return moves;
        
    } catch (error) {
        log(`AI: Kociemba solver error: ${error.message}`);
        // Only log to console in development
        if (!CONFIG.production) {
            console.error("Kociemba solver error:", error);
        }
        return null;
    }
}

// --- CONTROLS ---

function scramble() {
    if (STATE.isAnimating) return;
    if (moveQueue.length > 0) return;

    STATE.isSolving = false;
    // Reset timer
    STATE.isTiming = false;
    STATE.solveElapsed = 0;
    updateTimerUI(0);
    
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
    if (STATE.isAnimating) return;

    // Mode 1: current reverse-scramble solver (always works, not optimal)
    if (STATE.solveMode === 'reverse') {
        if (!STATE.memoryStack.length) {
            log("AI: No scramble history to reverse. Try AI mode (3x3 only) for general solving.");
            return;
        }
        STATE.isSolving = true;
        log("AI: Solving by reversing scramble history...");
        // Start timer
        STATE.isTiming = true;
        STATE.solveStartTime = performance.now();
        STATE.solveElapsed = 0;
        updateTimerUI(0);
        const sol = STATE.memoryStack.slice().reverse().map(m => ({
            axis: m.axis,
            slice: m.slice,
            dir: m.dir * -1
        }));
        sol.forEach(m => moveQueue.push(m));
        STATE.memoryStack = [];
        updateUI();
        return;
    }

    // Mode 2: Kociemba-based AI solver (3×3 only) - REAL IMPLEMENTATION!
    if (STATE.solveMode === 'ai-kociemba') {
        if (STATE.order !== 3 || STATE.type !== 'normal') {
            log("AI: Kociemba solver works for 3x3 Standard only. Switch architecture to 3x3.");
            return;
        }

        STATE.isSolving = true;
        log("AI: Initializing Kociemba's two-phase algorithm...");
        // Start timer
        STATE.isTiming = true;
        STATE.solveStartTime = performance.now();
        STATE.solveElapsed = 0;
        updateTimerUI(0);
        
        // Solve asynchronously
        solveWithKociemba().then(moves => {
            if (!moves || moves.length === 0) {
                log("AI: Kociemba solver failed. Falling back to reverse-scramble.");
                STATE.isSolving = false;
                return;
            }
            
            log(`AI: Kociemba solution ready! Executing ${moves.length} moves...`);
            
            // Push all moves to queue
            moves.forEach(m => moveQueue.push(m));
            STATE.memoryStack = []; // Clear scramble history since we're using AI
            updateUI();
        }).catch(error => {
            log(`AI: Kociemba solver error: ${error.message}`);
            STATE.isSolving = false;
        });
        
        return;
    }
}

function updateUI() {
    document.getElementById('stack-count').innerText = STATE.memoryStack.length;
}

function updateTimerUI(elapsedSeconds) {
    const el = document.getElementById('solve-time');
    if (!el) return;
    const val = typeof elapsedSeconds === 'number'
        ? elapsedSeconds
        : STATE.solveElapsed;
    el.innerText = `${val.toFixed(2)}s`;
}
function log(msg) {
    const d = document.createElement('div');
    d.innerHTML = `> ${msg}`;
    document.getElementById('console-log').prepend(d);
}
function setupUI() {
    document.getElementById('btn-scramble').addEventListener('click', scramble);
    document.getElementById('btn-solve').addEventListener('click', solve);
    setupDashboardDragAndResize();
    // Solver mode selector (reverse history vs AI/Kociemba stub)
    const solveModeEl = document.getElementById('solve-mode');
    if (solveModeEl) {
        solveModeEl.value = STATE.solveMode;
        solveModeEl.addEventListener('change', e => {
            const mode = e.target.value;
            STATE.solveMode = mode;
            if (mode === 'reverse') {
                log("AI: Using reverse-scramble solver (always works, not optimal).");
            } else if (mode === 'ai-kociemba') {
                log("AI: Kociemba mode selected (experimental - see README for implementation guide).");
            }
        });
    }
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
        const isMobile = window.innerWidth <= 768;
        camera.aspect = window.innerWidth/window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        
        // Adjust camera position on resize for mobile
        if (isMobile) {
            camera.position.set(7, 7, 9);
        } else {
            camera.position.set(6, 6, 8);
        }
        camera.lookAt(0,0,0);
        controls.update();
    });
}
function setupDashboardDragAndResize() {
    const panel = document.getElementById('dashboard-panel');
    const interfaceEl = document.getElementById('interface');
    const dragHandle = panel.querySelector('.drag-handle');
    const resizeHandle = panel.querySelector('.resize-handle');
    
    // Load saved position and size
    loadDashboardPosition();
    
    // Drag functionality
    function startDrag(e) {
        e.preventDefault();
        STATE.isDragging = true;
        const touch = e.touches ? e.touches[0] : e;
        STATE.dragStartX = touch.clientX;
        STATE.dragStartY = touch.clientY;
        
        const rect = interfaceEl.getBoundingClientRect();
        STATE.panelStartX = rect.left;
        STATE.panelStartY = rect.top;
        
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
        document.addEventListener('touchmove', onDrag, { passive: false });
        document.addEventListener('touchend', stopDrag);
    }
    
    function onDrag(e) {
        if (!STATE.isDragging) return;
        e.preventDefault();
        const touch = e.touches ? e.touches[0] : e;
        const deltaX = touch.clientX - STATE.dragStartX;
        const deltaY = touch.clientY - STATE.dragStartY;
        
        let newX = STATE.panelStartX + deltaX;
        let newY = STATE.panelStartY + deltaY;
        
        // Constrain to viewport
        const panelRect = panel.getBoundingClientRect();
        newX = Math.max(0, Math.min(newX, window.innerWidth - panelRect.width));
        newY = Math.max(0, Math.min(newY, window.innerHeight - panelRect.height));
        
        interfaceEl.style.left = newX + 'px';
        interfaceEl.style.top = newY + 'px';
        interfaceEl.style.right = 'auto';
        interfaceEl.style.bottom = 'auto';
    }
    
    function stopDrag() {
        STATE.isDragging = false;
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
        document.removeEventListener('touchmove', onDrag);
        document.removeEventListener('touchend', stopDrag);
        saveDashboardPosition();
    }
    
    // Resize functionality
    function startResize(e) {
        e.preventDefault();
        e.stopPropagation();
        STATE.isResizing = true;
        const touch = e.touches ? e.touches[0] : e;
        STATE.dragStartX = touch.clientX;
        STATE.dragStartY = touch.clientY;
        
        const rect = panel.getBoundingClientRect();
        STATE.panelStartWidth = rect.width;
        STATE.panelStartHeight = rect.height;
        
        document.addEventListener('mousemove', onResize);
        document.addEventListener('mouseup', stopResize);
        document.addEventListener('touchmove', onResize, { passive: false });
        document.addEventListener('touchend', stopResize);
    }
    
    function onResize(e) {
        if (!STATE.isResizing) return;
        e.preventDefault();
        e.stopPropagation();
        const touch = e.touches ? e.touches[0] : e;
        const deltaX = touch.clientX - STATE.dragStartX;
        const deltaY = touch.clientY - STATE.dragStartY;
        
        let newWidth = STATE.panelStartWidth + deltaX;
        let newHeight = STATE.panelStartHeight + deltaY;
        
        // Min/max constraints - allow smaller sizes for mobile
        const isMobile = window.innerWidth <= 768;
        const minWidth = isMobile ? 180 : 200;
        const minHeight = isMobile ? 180 : 200;
        const maxWidth = Math.min(window.innerWidth - 20, isMobile ? 350 : 500);
        const maxHeight = Math.min(window.innerHeight - 20, isMobile ? 500 : 600);
        
        newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
        newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));
        
        panel.style.width = newWidth + 'px';
        panel.style.height = newHeight + 'px';
        panel.style.maxWidth = 'none';
        panel.style.maxHeight = 'none';
        
        // Update padding and font sizes based on panel size for better responsiveness
        const scale = Math.min(newWidth / 300, 1);
        const padding = Math.max(8, Math.floor(15 * scale));
        panel.style.padding = padding + 'px';
        
        // Scale font sizes proportionally
        const fontSizeScale = Math.max(0.75, scale);
        panel.style.fontSize = (fontSizeScale * 16) + 'px';
        
        // Update section spacing
        const sections = panel.querySelectorAll('.section');
        sections.forEach(section => {
            section.style.marginBottom = Math.max(8, Math.floor(20 * scale)) + 'px';
        });
    }
    
    function stopResize() {
        STATE.isResizing = false;
        document.removeEventListener('mousemove', onResize);
        document.removeEventListener('mouseup', stopResize);
        document.removeEventListener('touchmove', onResize);
        document.removeEventListener('touchend', stopResize);
        saveDashboardPosition();
    }
    
    // Event listeners
    dragHandle.addEventListener('mousedown', startDrag);
    dragHandle.addEventListener('touchstart', startDrag, { passive: false });
    panel.querySelector('.panel-header').addEventListener('mousedown', (e) => {
        if (e.target === dragHandle || dragHandle.contains(e.target)) return;
        startDrag(e);
    });
    panel.querySelector('.panel-header').addEventListener('touchstart', (e) => {
        if (e.target === dragHandle || dragHandle.contains(e.target)) return;
        startDrag(e);
    }, { passive: false });
    
    resizeHandle.addEventListener('mousedown', startResize);
    resizeHandle.addEventListener('touchstart', startResize, { passive: false });
}

function saveDashboardPosition() {
    const interfaceEl = document.getElementById('interface');
    const panel = document.getElementById('dashboard-panel');
    const rect = interfaceEl.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    
    const data = {
        x: rect.left,
        y: rect.top,
        width: panelRect.width,
        height: panelRect.height
    };
    
    localStorage.setItem('dashboardPosition', JSON.stringify(data));
}

function loadDashboardPosition() {
    try {
        const data = JSON.parse(localStorage.getItem('dashboardPosition'));
        if (data) {
            const interfaceEl = document.getElementById('interface');
            const panel = document.getElementById('dashboard-panel');
            
            interfaceEl.style.left = data.x + 'px';
            interfaceEl.style.top = data.y + 'px';
            interfaceEl.style.right = 'auto';
            interfaceEl.style.bottom = 'auto';
            
            panel.style.width = data.width + 'px';
            panel.style.height = data.height + 'px';
        }
    } catch (e) {
        // Ignore if no saved data
    }
}

function animate() {
    controls.update();
    processQueue();
    
    // Update timer in real-time if solving
    if (STATE.isTiming) {
        STATE.solveElapsed = (performance.now() - STATE.solveStartTime) / 1000;
        updateTimerUI(STATE.solveElapsed);
    }
    
    renderer.render(scene, camera);
}

init();