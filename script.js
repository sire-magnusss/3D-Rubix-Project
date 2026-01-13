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

// --- LOGIC CLASS ---
class VirtualCube {
    constructor(order, type) {
        this.pieces = [];
        const offset = (order - 1) / 2;
        
        for (let x = 0; x < order; x++) {
            for (let y = 0; y < order; y++) {
                for (let z = 0; z < order; z++) {
                    this.pieces.push({
                        // CURRENT LOGIC STATE
                        x: x - offset, y: y - offset, z: z - offset,
                        q: new THREE.Quaternion(),
                        
                        // CONSTANT ID
                        ox: x - offset, oy: y - offset, oz: z - offset,
                        
                        // VISUAL LINK
                        mesh: null,
                        
                        // ANIMATION BUFFERS (Start -> End)
                        startPos: new THREE.Vector3(),
                        startRot: new THREE.Quaternion(),
                        targetPos: new THREE.Vector3(),
                        targetRot: new THREE.Quaternion()
                    });
                }
            }
        }
    }

    // Calculates the "Next State" for a piece without applying it yet
    calculateNextState(p, axis, dir) {
        // 1. Position Rotation (Integers)
        let nx = p.x, ny = p.y, nz = p.z;
        if (axis === 'x') {
            ny = (dir === -1) ? p.z : -p.z;
            nz = (dir === -1) ? -p.y : p.y;
        }
        if (axis === 'y') {
            nz = (dir === -1) ? p.x : -p.x;
            nx = (dir === -1) ? -p.z : p.z;
        }
        if (axis === 'z') {
            nx = (dir === -1) ? p.y : -p.y;
            ny = (dir === -1) ? -p.x : p.x;
        }
        
        // Clean Floats
        nx = Math.round(nx * 2) / 2;
        ny = Math.round(ny * 2) / 2;
        nz = Math.round(nz * 2) / 2;

        // 2. Rotation Quaternion
        const axisVec = new THREE.Vector3();
        axisVec[axis] = 1;
        const rotQ = new THREE.Quaternion().setFromAxisAngle(axisVec, dir * (Math.PI / 2));
        
        const nextQ = p.q.clone().premultiply(rotQ).normalize();

        return { x: nx, y: ny, z: nz, q: nextQ };
    }

    // Commit the calculated state to the logic
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
    const spacing = (type === 'mirror') ? 1.4 : CONFIG.spacing;

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

    syncVisuals();
}

// Teleport visuals to exact logic state
function syncVisuals() {
    const spacing = (STATE.type === 'mirror') ? 1.4 : CONFIG.spacing;
    logicCube.pieces.forEach(p => {
        p.mesh.position.set(p.x * spacing, p.y * spacing, p.z * spacing);
        p.mesh.quaternion.copy(p.q);
        p.mesh.updateMatrix();
    });
}

// --- ANIMATION CONTROLLER (START -> END INTERPOLATION) ---
let currentMove = null;
let progress = 0;
let activeGroup = [];

function processQueue() {
    if (!moveQueue.length) {
        if (STATE.isAnimating) {
            STATE.isAnimating = false;
            document.getElementById('ai-state').innerText = "IDLE";
            document.getElementById('ai-state').style.color = "#666";
            
            // Safety Check
            syncVisuals();
            checkAlignment();
        }
        return;
    }

    if (!currentMove) {
        // --- PREPARE MOVE ---
        // Ensure we start from a clean state
        syncVisuals();

        currentMove = moveQueue.shift();
        STATE.isAnimating = true;
        progress = 0;
        document.getElementById('ai-state').innerText = "PROCESSING";
        document.getElementById('ai-state').style.color = "#00ff88";

        activeGroup = [];
        const eps = 0.1;
        const spacing = (STATE.type === 'mirror') ? 1.4 : CONFIG.spacing;

        logicCube.pieces.forEach(p => {
            // Check if piece belongs to moving slice
            if (Math.abs(p[currentMove.axis] - currentMove.slice) < eps) {
                // 1. Calculate START State
                p.startPos.set(p.x * spacing, p.y * spacing, p.z * spacing);
                p.startRot.copy(p.q);

                // 2. Calculate TARGET State
                const next = logicCube.calculateNextState(p, currentMove.axis, currentMove.dir);
                p.targetPos.set(next.x * spacing, next.y * spacing, next.z * spacing);
                p.targetRot.copy(next.q);
                
                // Store next state for commit
                p.nextState = next;

                activeGroup.push(p);
            }
        });
    }

    const speed = CONFIG.animSpeed;
    
    // Turbo Mode: Instant Finish
    if (speed >= 1.5) {
        progress = 1.1;
    } else {
        progress += speed;
    }

    if (progress >= 1.0) {
        // --- FINISH MOVE ---
        activeGroup.forEach(p => {
            logicCube.commitState(p, p.nextState);
        });

        // Hard Sync
        syncVisuals();
        
        currentMove = null;
        activeGroup = [];
    } else {
        // --- INTERPOLATE ---
        // We do not rotate using an axis here. We simply blend between Start and Target.
        // This avoids all accumulation errors.
        activeGroup.forEach(p => {
            // Position LERP
            p.mesh.position.lerpVectors(p.startPos, p.targetPos, progress);
            
            // Rotation SLERP
            p.mesh.quaternion.slerpQuaternions(p.startRot, p.targetRot, progress);
        });
    }
}

// --- AI AUTO-FIX ---
function checkAlignment() {
    if (STATE.memoryStack.length > 0) return;
    
    // Check Top Center
    const upPiece = logicCube.pieces.find(p => p.y === 1 && p.x === 0 && p.z === 0);
    if(upPiece) {
        const fwd = new THREE.Vector3(0,0,1).applyQuaternion(upPiece.q);
        if(Math.abs(fwd.z - 1) > 0.1) {
            log("AI: Correcting Alignment...");
            moveQueue.push({ axis: 'y', slice: 1, dir: 1 });
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
        if (val <= 10) CONFIG.animSpeed = val * 0.05; 
        else CONFIG.animSpeed = val * 0.15; // Turbo
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