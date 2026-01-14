import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- CONFIGURATION ---
const CONFIG = {
    colors: {
        R: 0xb90000, L: 0xff5900, U: 0xffffff, D: 0xffd500, F: 0x009b48, B: 0x0045ad, CORE: 0x111111
    },
    spacing: 1.05,
    animSpeed: 0.25
};

// --- STATE ---
const STATE = {
    order: 3,
    type: 'normal',
    isAnimating: false,
    memoryStack: []
};

// --- GLOBALS ---
let scene, camera, renderer, controls;
let allCubelets = [];
const moveQueue = [];
let logicCube = null;

// --- DATABASE OF PERFECTION (24 Valid Rotations) ---
// This prevents "Wrong Face" colors by locking rotation to known valid states.
const VALID_QUATERNIONS = [];
(function buildDatabase() {
    const axes = [
        new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
        new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)
    ];
    for (let fwd of axes) {
        for (let up of axes) {
            if (Math.abs(fwd.dot(up)) < 0.01) { 
                const m = new THREE.Matrix4();
                const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
                m.makeBasis(right, up, fwd);
                const q = new THREE.Quaternion().setFromRotationMatrix(m);
                let exists = false;
                for(let vq of VALID_QUATERNIONS) if(vq.dot(q) > 0.99) exists = true;
                if(!exists) VALID_QUATERNIONS.push(q);
            }
        }
    }
})();

// --- INITIALIZATION ---
function init() {
    const container = document.getElementById('viewport');
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 100);
    camera.position.set(6, 6, 8);
    camera.lookAt(0,0,0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

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
                        // Logic State
                        x: x - offset, y: y - offset, z: z - offset,
                        q: new THREE.Quaternion(), 
                        
                        // ID
                        ox: x - offset, oy: y - offset, oz: z - offset,
                        isCenter: (Math.abs(x-offset)+Math.abs(y-offset)+Math.abs(z-offset) === 1),
                        
                        // Visual
                        mesh: null,
                        
                        // Animation Buffers
                        startPos: new THREE.Vector3(),
                        startRot: new THREE.Quaternion(),
                        targetPos: new THREE.Vector3(),
                        targetRot: new THREE.Quaternion()
                    });
                }
            }
        }
    }

    // Pre-calculate the destination before animation starts
    calculateNextState(p, axis, dir) {
        // 1. Position Rotation (Float -> Int)
        const pos = new THREE.Vector3(p.x, p.y, p.z);
        const axisVec = new THREE.Vector3();
        axisVec[axis] = 1;
        pos.applyAxisAngle(axisVec, dir * (Math.PI / 2));
        
        const nx = Math.round(pos.x * 2) / 2;
        const ny = Math.round(pos.y * 2) / 2;
        const nz = Math.round(pos.z * 2) / 2;

        // 2. Rotation Calculation
        const rotQ = new THREE.Quaternion().setFromAxisAngle(axisVec, dir * (Math.PI / 2));
        const rawNextQ = p.q.clone().premultiply(rotQ).normalize();

        // 3. QUANTUM SNAP (Fixes the "Wrong Face" bug)
        // We find the mathematically perfect quaternion from our database.
        let bestQ = rawNextQ;
        let maxDot = -1;
        for(let vq of VALID_QUATERNIONS) {
            const dot = Math.abs(rawNextQ.dot(vq));
            if(dot > maxDot) { maxDot = dot; bestQ = vq; }
        }

        return { x: nx, y: ny, z: nz, q: bestQ.clone() };
    }

    commitState(p, nextState) {
        p.x = nextState.x;
        p.y = nextState.y;
        p.z = nextState.z;
        p.q.copy(nextState.q);
    }
}

function buildPuzzle(order, type) {
    STATE.order = order;
    STATE.type = type;
    STATE.memoryStack = [];
    updateUI();

    allCubelets.forEach(m => {
        scene.remove(m);
        if(m.geometry) m.geometry.dispose();
    });
    allCubelets = [];

    logicCube = new VirtualCube(order, type);
    const geom = new THREE.BoxGeometry(1, 1, 1);
    
    logicCube.pieces.forEach(p => {
        const ox = p.ox, oy = p.oy, oz = p.oz;
        const offset = (order - 1) / 2;

        const materials = [
            new THREE.MeshStandardMaterial({ color: ox === offset ? CONFIG.colors.R : CONFIG.colors.CORE }),
            new THREE.MeshStandardMaterial({ color: ox === -offset ? CONFIG.colors.L : CONFIG.colors.CORE }),
            new THREE.MeshStandardMaterial({ color: oy === offset ? CONFIG.colors.U : CONFIG.colors.CORE }),
            new THREE.MeshStandardMaterial({ color: oy === -offset ? CONFIG.colors.D : CONFIG.colors.CORE }),
            new THREE.MeshStandardMaterial({ color: oz === offset ? CONFIG.colors.F : CONFIG.colors.CORE }),
            new THREE.MeshStandardMaterial({ color: oz === -offset ? CONFIG.colors.B : CONFIG.colors.CORE }),
        ];

        if (type === 'mirror') materials.forEach(m => { m.color.setHex(0x333333); m.roughness = 0.2; });

        const mesh = new THREE.Mesh(geom, materials);
        if (type === 'mirror') mesh.scale.set(1 + ox*0.35, 1 + oy*0.35, 1 + oz*0.35);

        mesh.add(new THREE.LineSegments(
            new THREE.EdgesGeometry(geom),
            new THREE.LineBasicMaterial({ color: 0x000000 })
        ));

        p.mesh = mesh;
        scene.add(mesh);
        allCubelets.push(mesh);
    });

    forceVisualSync();
}

// Teleport visuals to exact logic state
function forceVisualSync() {
    const spacing = (STATE.type === 'mirror') ? 1.4 : CONFIG.spacing;
    logicCube.pieces.forEach(p => {
        p.mesh.position.set(p.x * spacing, p.y * spacing, p.z * spacing);
        p.mesh.quaternion.copy(p.q);
        p.mesh.updateMatrix();
        p.mesh.updateMatrixWorld();
    });
}

// --- ANIMATION ENGINE (STATELESS ARC) ---
let currentMove = null;
let progress = 0;
let activeGroup = [];

function processQueue() {
    if (!moveQueue.length) {
        if (STATE.isAnimating) {
            STATE.isAnimating = false;
            document.getElementById('ai-state').innerText = "IDLE";
            document.getElementById('ai-state').style.color = "#666";
            
            forceVisualSync();
            checkAndFixAlignment();
        }
        return;
    }

    if (!currentMove) {
        // --- START ---
        forceVisualSync(); // Clean start
        
        currentMove = moveQueue.shift();
        STATE.isAnimating = true;
        progress = 0;
        document.getElementById('ai-state').innerText = "PROCESSING";
        document.getElementById('ai-state').style.color = "#00ff88";

        activeGroup = [];
        const eps = 0.1;
        const spacing = (STATE.type === 'mirror') ? 1.4 : CONFIG.spacing;

        logicCube.pieces.forEach(p => {
            if (Math.abs(p[currentMove.axis] - currentMove.slice) < eps) {
                // Snapshot Start
                p.startPos.set(p.x * spacing, p.y * spacing, p.z * spacing);
                p.startRot.copy(p.q);

                // Calculate Target (Quantum Snapped)
                const next = logicCube.calculateNextState(p, currentMove.axis, currentMove.dir);
                
                // Store Target
                p.nextState = next;
                
                activeGroup.push(p);
            }
        });
    }

    const speed = CONFIG.animSpeed;
    
    // Turbo Mode
    if (speed > 1.0) {
        progress = 1.1;
    } else {
        progress += speed;
    }

    if (progress >= 1.0) {
        // --- FINISH ---
        
        // 1. Commit the Quantum State
        activeGroup.forEach(p => {
            logicCube.commitState(p, p.nextState);
        });

        // 2. Hard Teleport (No visual drift possible)
        forceVisualSync();

        currentMove = null;
        activeGroup = [];
    } else {
        // --- ANIMATE ---
        // We calculate the exact position on the circle for this specific frame.
        // No Pivots. No Parenting. Pure Math.
        
        const angle = currentMove.dir * progress * (Math.PI / 2);
        const axisVec = new THREE.Vector3();
        axisVec[currentMove.axis] = 1;

        activeGroup.forEach(p => {
            // Position: Rotate the vector around origin (0,0,0)
            p.mesh.position.copy(p.startPos).applyAxisAngle(axisVec, angle);
            
            // Rotation: Rotate the quaternion
            const qRot = new THREE.Quaternion().setFromAxisAngle(axisVec, angle);
            p.mesh.quaternion.copy(p.startRot).premultiply(qRot);
        });
    }
}

// --- AI AUTO-FIX ---
function checkAndFixAlignment() {
    if (STATE.memoryStack.length > 0) return;

    // Check Top Center (y=1)
    const topPiece = logicCube.pieces.find(p => p.oy === 1 && p.isCenter);
    if(topPiece) {
        if(Math.abs(topPiece.y - 1) > 0.1) {
            log("AI: Aligning Top...");
            moveQueue.push({ axis: 'x', slice: 0, dir: 1 });
            moveQueue.push({ axis: 'x', slice: 1, dir: 1 });
            moveQueue.push({ axis: 'x', slice: -1, dir: 1 });
            return;
        }
    }
}

// --- CONTROLS ---

function scramble() {
    if (STATE.isAnimating) return;
    if (moveQueue.length > 0) return;

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
    if(STATE.memoryStack.length === 0) document.getElementById('opt-percent').innerText = "0%";
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
        if (val <= 5) CONFIG.animSpeed = val * 0.02; // Slow
        else if (val <= 15) CONFIG.animSpeed = (val - 5) * 0.05 + 0.1; 
        else CONFIG.animSpeed = 2.0; // Turbo
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