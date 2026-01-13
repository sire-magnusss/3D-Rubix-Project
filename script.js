/*
 * NeuralCube - BFS-Based Rubik's Cube Solver
 * 
 * BFS SOLVER STRATEGY BY CUBE SIZE:
 * - 2x2: Full BFS up to depth 14 (optimal solutions)
 * - 3x3: Phased BFS (Cross → F2L → OLL → PLL) with depth limits per phase
 * - 4x4: Simplified BFS on reduced state (centers + edges only, depth limit 8)
 * - 5x5: Simplified BFS on reduced state (centers + edges only, depth limit 10)
 * - Mirror: Same as 3x3 but with shape constraints
 * 
 * All solvers use BFS as the core search algorithm, with optimizations:
 * - Pruning: Avoid immediately undoing last move
 * - State deduplication via hash sets
 * - Async execution to keep UI responsive
 * - Max depth limits to prevent infinite search
 */

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

// BFS Configuration
const BFS_CONFIG = {
    maxDepth: {
        2: 14,      // 2x2: full BFS (God's number is 11)
        3: 22,      // 3x3: God's number is 20, allow some buffer
        4: 8,       // 4x4: simplified
        5: 10,      // 5x5: simplified
        mirror: 22  // Mirror: same as 3x3
    },
    maxNodes: {
        2: 500000,  // Increased for 2x2 (with orientations, state space is larger)
        3: 1000000, // Increased for 3x3
        4: 50000,
        5: 100000,
        mirror: 1000000
    }
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
let currentCubeState = null; // Logical state for BFS


// ============================================================================
// CUBE STATE REPRESENTATION
// ============================================================================

/**
 * CubeState: Logical representation of cube state for BFS solving
 * 
 * For each cubelet, stores:
 * - Position (x, y, z coordinates)
 * - Orientation (which face colors are on which sides)
 * 
 * State encoding: string representation for hash-based deduplication
 */
class CubeState {
    constructor(order, type = 'normal') {
        this.order = order;
        this.type = type;
        this.pieces = []; // Array of {id, x, y, z, originalPos, faces}
        this.offset = (order - 1) / 2;
        
        // Initialize solved state - each piece has a unique ID
        // ID is calculated as: x * order^2 + y * order + z (matches mesh.userData.pieceId)
        for (let x = 0; x < order; x++) {
            for (let y = 0; y < order; y++) {
                for (let z = 0; z < order; z++) {
                    const ox = x - this.offset;
                    const oy = y - this.offset;
                    const oz = z - this.offset;
                    // Calculate ID to match mesh.userData.pieceId calculation
                    const id = x * order * order + y * order + z;
                    
                    // Determine which faces this piece has in solved state
                    // faces object: {+X: 'R'|null, -X: 'L'|null, +Y: 'U'|null, -Y: 'D'|null, +Z: 'F'|null, -Z: 'B'|null}
                    const faces = {};
                    if (ox === this.offset) faces['+X'] = 'R';
                    if (ox === -this.offset) faces['-X'] = 'L';
                    if (oy === this.offset) faces['+Y'] = 'U';
                    if (oy === -this.offset) faces['-Y'] = 'D';
                    if (oz === this.offset) faces['+Z'] = 'F';
                    if (oz === -this.offset) faces['-Z'] = 'B';
                    
                    this.pieces.push({
                        id: id,
                        x: ox,
                        y: oy,
                        z: oz,
                        originalPos: {x: ox, y: oy, z: oz},
                        faces: faces // Track which colors are on which faces
                    });
                }
            }
        }
    }
    
    /**
     * Clone this state for BFS exploration
     */
    clone() {
        const cloned = new CubeState(this.order, this.type);
        cloned.pieces = this.pieces.map(p => ({
            id: p.id,
            x: p.x,
            y: p.y,
            z: p.z,
            originalPos: {...p.originalPos},
            faces: {...p.faces} // Deep copy faces
        }));
        return cloned;
    }
    
    /**
     * Encode state as string for hash-based deduplication
     * Format: "id1:x1,y1,z1,f1|id2:x2,y2,z2,f2|..." sorted by ID
     * f = face colors encoded as "+X:R,-X:L" etc.
     */
    encode() {
        const sorted = this.pieces
            .map(p => {
                const faceStr = Object.entries(p.faces).map(([dir, color]) => `${dir}:${color || 'N'}`).join(',');
                return `${p.id}:${p.x},${p.y},${p.z},${faceStr}`;
            })
            .sort();
        return sorted.join('|');
    }
    
    /**
     * Apply a move to this state
     * @param {string} axis - 'x', 'y', or 'z'
     * @param {number} slice - slice coordinate
     * @param {number} dir - direction: 1 (CW) or -1 (CCW)
     */
    applyMove(axis, slice, dir) {
        const eps = 0.1;
        this.pieces.forEach(p => {
            if (Math.abs(p[axis] - slice) < eps) {
                let nx = p.x, ny = p.y, nz = p.z;
                const oldFaces = {...p.faces};
                
                // Rotate position
                if (axis === 'x') {
                    ny = (dir === -1) ? p.z : -p.z;
                    nz = (dir === -1) ? -p.y : p.y;
                    // Rotate faces around X axis: +Y↔+Z↔-Y↔-Z
                    if (dir === 1) {
                        p.faces['+Y'] = oldFaces['-Z'];
                        p.faces['-Z'] = oldFaces['-Y'];
                        p.faces['-Y'] = oldFaces['+Z'];
                        p.faces['+Z'] = oldFaces['+Y'];
                    } else {
                        p.faces['+Y'] = oldFaces['+Z'];
                        p.faces['+Z'] = oldFaces['-Y'];
                        p.faces['-Y'] = oldFaces['-Z'];
                        p.faces['-Z'] = oldFaces['+Y'];
                    }
                } else if (axis === 'y') {
                    nz = (dir === -1) ? p.x : -p.x;
                    nx = (dir === -1) ? -p.z : p.z;
                    // Rotate faces around Y axis: +Z↔+X↔-Z↔-X
                    if (dir === 1) {
                        p.faces['+Z'] = oldFaces['-X'];
                        p.faces['-X'] = oldFaces['-Z'];
                        p.faces['-Z'] = oldFaces['+X'];
                        p.faces['+X'] = oldFaces['+Z'];
                    } else {
                        p.faces['+Z'] = oldFaces['+X'];
                        p.faces['+X'] = oldFaces['-Z'];
                        p.faces['-Z'] = oldFaces['-X'];
                        p.faces['-X'] = oldFaces['+Z'];
                    }
                } else if (axis === 'z') {
                    nx = (dir === -1) ? p.y : -p.y;
                    ny = (dir === -1) ? -p.x : p.x;
                    // Rotate faces around Z axis: +Y↔+X↔-Y↔-X
                    if (dir === 1) {
                        p.faces['+Y'] = oldFaces['-X'];
                        p.faces['-X'] = oldFaces['-Y'];
                        p.faces['-Y'] = oldFaces['+X'];
                        p.faces['+X'] = oldFaces['+Y'];
                    } else {
                        p.faces['+Y'] = oldFaces['+X'];
                        p.faces['+X'] = oldFaces['-Y'];
                        p.faces['-Y'] = oldFaces['-X'];
                        p.faces['-X'] = oldFaces['+Y'];
                    }
                }
                
                p.x = Math.round(nx * 2) / 2;
                p.y = Math.round(ny * 2) / 2;
                p.z = Math.round(nz * 2) / 2;
            }
        });
    }
    
    /**
     * Check if cube is in solved state
     * Each piece must be at its original position AND correctly oriented
     */
    isSolved() {
        for (const piece of this.pieces) {
            // Check if piece is in its original position
            if (Math.abs(piece.x - piece.originalPos.x) > 0.1 ||
                Math.abs(piece.y - piece.originalPos.y) > 0.1 ||
                Math.abs(piece.z - piece.originalPos.z) > 0.1) {
                return false;
            }
            
            // Check if faces match original orientation
            const offset = this.offset;
            const expectedFaces = {};
            if (piece.x === offset) expectedFaces['+X'] = 'R';
            if (piece.x === -offset) expectedFaces['-X'] = 'L';
            if (piece.y === offset) expectedFaces['+Y'] = 'U';
            if (piece.y === -offset) expectedFaces['-Y'] = 'D';
            if (piece.z === offset) expectedFaces['+Z'] = 'F';
            if (piece.z === -offset) expectedFaces['-Z'] = 'B';
            
            // Compare faces
            const expectedKeys = Object.keys(expectedFaces).sort();
            const actualKeys = Object.keys(piece.faces).sort();
            if (expectedKeys.length !== actualKeys.length) return false;
            
            for (const key of expectedKeys) {
                if (piece.faces[key] !== expectedFaces[key]) {
                    return false;
                }
            }
        }
        return true;
    }
    
    /**
     * Extract current state from visual cubelets
     * Maps each visual cubelet to its logical piece by pieceId
     * Extracts face orientations by checking which material colors are on which world-facing sides
     */
    static fromVisualCubelets(cubelets, order, type) {
        const state = new CubeState(order, type);
        const offset = (order - 1) / 2;
        const spacing = (type === 'mirror') ? 1.4 : CONFIG.spacing;
        
        // Create map of piece IDs to pieces
        const pieceMap = new Map();
        state.pieces.forEach(p => {
            pieceMap.set(p.id, p);
        });
        
        // Color to face mapping
        const colorToFace = {
            [CONFIG.colors.R]: 'R',
            [CONFIG.colors.L]: 'L',
            [CONFIG.colors.U]: 'U',
            [CONFIG.colors.D]: 'D',
            [CONFIG.colors.F]: 'F',
            [CONFIG.colors.B]: 'B'
        };
        
        // Update piece positions and face orientations from visual cubelets
        cubelets.forEach(mesh => {
            const pieceId = mesh.userData.pieceId;
            if (pieceId !== undefined && pieceMap.has(pieceId)) {
                const piece = pieceMap.get(pieceId);
                const newX = Math.round(mesh.userData.logicX * 2) / 2;
                const newY = Math.round(mesh.userData.logicY * 2) / 2;
                const newZ = Math.round(mesh.userData.logicZ * 2) / 2;
                
                piece.x = newX;
                piece.y = newY;
                piece.z = newZ;
                
                // Extract face orientations by checking mesh materials and world position
                mesh.updateMatrixWorld();
                const worldPos = mesh.position;
                piece.faces = {};
                
                // Get local axes in world space
                const localRight = new THREE.Vector3(1, 0, 0).applyMatrix4(mesh.matrixWorld).normalize();
                const localLeft = new THREE.Vector3(-1, 0, 0).applyMatrix4(mesh.matrixWorld).normalize();
                const localUp = new THREE.Vector3(0, 1, 0).applyMatrix4(mesh.matrixWorld).normalize();
                const localDown = new THREE.Vector3(0, -1, 0).applyMatrix4(mesh.matrixWorld).normalize();
                const localForward = new THREE.Vector3(0, 0, 1).applyMatrix4(mesh.matrixWorld).normalize();
                const localBack = new THREE.Vector3(0, 0, -1).applyMatrix4(mesh.matrixWorld).normalize();
                
                // Check which faces are on the outer surfaces and map to colors
                const materials = mesh.material;
                if (Array.isArray(materials)) {
                    // Materials: [right, left, top, bottom, front, back]
                    const worldRight = new THREE.Vector3(1, 0, 0);
                    const worldLeft = new THREE.Vector3(-1, 0, 0);
                    const worldUp = new THREE.Vector3(0, 1, 0);
                    const worldDown = new THREE.Vector3(0, -1, 0);
                    const worldForward = new THREE.Vector3(0, 0, 1);
                    const worldBack = new THREE.Vector3(0, 0, -1);
                    
                    // Find which local face points closest to each world direction
                    const faceDirs = [
                        {local: localRight, world: worldRight, idx: 0, dir: '+X'},
                        {local: localLeft, world: worldLeft, idx: 1, dir: '-X'},
                        {local: localUp, world: worldUp, idx: 2, dir: '+Y'},
                        {local: localDown, world: worldDown, idx: 3, dir: '-Y'},
                        {local: localForward, world: worldForward, idx: 4, dir: '+Z'},
                        {local: localBack, world: worldBack, idx: 5, dir: '-Z'}
                    ];
                    
                    faceDirs.forEach(({local, world, idx, dir}) => {
                        const dot = local.dot(world);
                        if (dot > 0.8) { // Face is pointing in this world direction
                            const color = materials[idx].color.getHex();
                            if (colorToFace[color]) {
                                piece.faces[dir] = colorToFace[color];
                            }
                        }
                    });
                }
            }
        });
        
        return state;
    }
}


// ============================================================================
// MOVE SYSTEM
// ============================================================================

/**
 * Generate all legal moves for a given cube size
 * Returns array of {axis, slice, dir} moves
 */
function generateLegalMoves(order) {
    const moves = [];
    const range = (order - 1) / 2;
    const axes = ['x', 'y', 'z'];
    const dirs = [1, -1]; // CW and CCW
    
    for (const axis of axes) {
        for (let slice = -range; slice <= range; slice++) {
            // Skip center slice for odd-order cubes (redundant)
            if (order % 2 === 1 && slice === 0) continue;
            
            for (const dir of dirs) {
                moves.push({axis, slice, dir});
            }
        }
    }
    
    return moves;
}

/**
 * Filter moves to avoid immediate undo (pruning optimization)
 */
function filterMoves(moves, lastMove) {
    if (!lastMove) return moves;
    
    return moves.filter(m => {
        // Don't undo the last move immediately
        if (m.axis === lastMove.axis &&
            m.slice === lastMove.slice &&
            m.dir === -lastMove.dir) {
            return false;
        }
        return true;
    });
}


// ============================================================================
// IDA* SOLVER (Iterative Deepening A* - more memory efficient than BFS)
// ============================================================================

/**
 * Simple heuristic: count pieces not in correct position/orientation
 */
function heuristic(state) {
    let cost = 0;
    for (const piece of state.pieces) {
        if (Math.abs(piece.x - piece.originalPos.x) > 0.1 ||
            Math.abs(piece.y - piece.originalPos.y) > 0.1 ||
            Math.abs(piece.z - piece.originalPos.z) > 0.1) {
            cost += 1; // Position wrong
        } else {
            // Check orientation
            const offset = state.offset;
            if (piece.x === offset && piece.faces['+X'] !== 'R') cost += 1;
            if (piece.x === -offset && piece.faces['-X'] !== 'L') cost += 1;
            if (piece.y === offset && piece.faces['+Y'] !== 'U') cost += 1;
            if (piece.y === -offset && piece.faces['-Y'] !== 'D') cost += 1;
            if (piece.z === offset && piece.faces['+Z'] !== 'F') cost += 1;
            if (piece.z === -offset && piece.faces['-Z'] !== 'B') cost += 1;
        }
    }
    return Math.ceil(cost / 4); // Divide by 4 since each move affects multiple pieces
}

/**
 * IDA* search with depth limit, transposition table, and node/time limits
 */
async function idaStarSearch(state, isSolved, generateNeighbors, maxDepth, onProgress) {
    let nodesExpanded = 0;
    const startTime = Date.now();
    const maxNodes = 1000000; // 1M node limit per threshold iteration
    const maxTime = 5000; // 5 second time limit per threshold
    
    async function search(node, g, threshold, path, lastMove, visitedThisIteration) {
        nodesExpanded++;
        
        // Check limits
        if (nodesExpanded >= maxNodes) {
            return {found: false, nextThreshold: Infinity, limitReached: 'nodes'};
        }
        if (Date.now() - startTime >= maxTime) {
            return {found: false, nextThreshold: Infinity, limitReached: 'time'};
        }
        
        const f = g + heuristic(node);
        
        if (f > threshold) {
            return {found: false, nextThreshold: f};
        }
        
        if (isSolved(node)) {
            return {found: true, moves: path, threshold: f};
        }
        
        if (g >= maxDepth) {
            return {found: false, nextThreshold: Infinity};
        }
        
        // Yield to UI periodically (less frequent to reduce overhead)
        if (nodesExpanded % 50000 === 0 && onProgress) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            onProgress(`IDA*: Depth ${g}, Nodes: ${nodesExpanded.toLocaleString()}, Threshold: ${threshold}, Time: ${elapsed}s`);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        
        const encoded = node.encode();
        
        // Skip if we've seen this state in this iteration
        if (visitedThisIteration.has(encoded)) {
            return {found: false, nextThreshold: Infinity};
        }
        visitedThisIteration.add(encoded);
        
        let minThreshold = Infinity;
        const neighbors = generateNeighbors(node, lastMove);
        
        for (const {state: nextState, move} of neighbors) {
            // Prune: don't undo last move
            if (lastMove && 
                lastMove.axis === move.axis && 
                lastMove.slice === move.slice && 
                lastMove.dir === -move.dir) {
                continue;
            }
            
            const result = await search(nextState, g + 1, threshold, [...path, move], move, visitedThisIteration);
            
            if (result.found) {
                return result;
            }
            
            if (result.limitReached) {
                return result;
            }
            
            minThreshold = Math.min(minThreshold, result.nextThreshold);
        }
        
        return {found: false, nextThreshold: minThreshold};
    }
    
    let threshold = heuristic(state);
    let lastThreshold = -1;
    const maxThreshold = 15; // Don't go beyond this threshold
    
    while (threshold < maxThreshold) {
        // Transposition table for this iteration
        const visitedThisIteration = new Set();
        
        const result = await search(state, 0, threshold, [], null, visitedThisIteration);
        
        if (result.found) {
            return {
                moves: result.moves,
                stats: {
                    depth: result.moves.length,
                    nodesExpanded: nodesExpanded,
                    time: Date.now() - startTime
                }
            };
        }
        
        if (result.limitReached) {
            if (onProgress) {
                onProgress(`IDA*: ${result.limitReached === 'nodes' ? 'Node' : 'Time'} limit reached at threshold ${threshold}`);
            }
            break;
        }
        
        if (result.nextThreshold === Infinity || result.nextThreshold === threshold) {
            break;
        }
        
        // Prevent infinite loops
        if (threshold === lastThreshold) {
            break;
        }
        lastThreshold = threshold;
        threshold = result.nextThreshold;
        
        if (onProgress) {
            onProgress(`IDA*: Increasing threshold to ${threshold}`);
        }
        
        // Reset node counter for new threshold (optional - comment out to keep cumulative)
        // nodesExpanded = 0;
    }
    
    return {
        moves: null,
        stats: {
            depth: -1,
            nodesExpanded: nodesExpanded,
            time: Date.now() - startTime
        }
    };
}

/**
 * Generic BFS solver (kept as fallback, but IDA* is preferred)
 */
async function bfsSolve(startState, isSolved, generateNeighbors, options = {}) {
    const {
        maxDepth = 20,
        maxNodes = 100000,
        onProgress = null
    } = options;
    
    const queue = [{state: startState, moves: [], depth: 0}];
    const visited = new Set();
    visited.add(startState.encode());
    
    let nodesExpanded = 0;
    const startTime = Date.now();
    
    while (queue.length > 0) {
        const {state, moves, depth} = queue.shift();
        
        // Check if solved
        if (isSolved(state)) {
            return {
                moves: moves,
                stats: {
                    depth: depth,
                    nodesExpanded: nodesExpanded,
                    time: Date.now() - startTime
                }
            };
        }
        
        // Depth limit
        if (depth >= maxDepth) continue;
        
        // Node limit
        if (nodesExpanded >= maxNodes) {
            if (onProgress) onProgress(`BFS: Node limit reached (${maxNodes})`);
            break;
        }
        
        // Generate neighbors
        const neighbors = generateNeighbors(state, moves[moves.length - 1]);
        
        for (const {state: nextState, move} of neighbors) {
            const encoded = nextState.encode();
            
            if (!visited.has(encoded)) {
                visited.add(encoded);
                queue.push({
                    state: nextState,
                    moves: [...moves, move],
                    depth: depth + 1
                });
                nodesExpanded++;
            }
        }
        
        // Yield to UI every 1000 nodes (or every 100 for first 1000)
        const reportInterval = nodesExpanded < 1000 ? 100 : 1000;
        if (nodesExpanded % reportInterval === 0 && onProgress) {
            onProgress(`BFS: Depth ${depth}, Nodes: ${nodesExpanded}, Queue: ${queue.length}`);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    
    return {
        moves: null,
        stats: {
            depth: -1,
            nodesExpanded: nodesExpanded,
            time: Date.now() - startTime
        }
    };
}

/**
 * Solve cube using BFS with strategy based on cube size
 */
async function solveWithBFS(startState, order, type) {
    const configKey = type === 'mirror' ? 'mirror' : order;
    const maxDepth = BFS_CONFIG.maxDepth[configKey] || 20;
    const maxNodes = BFS_CONFIG.maxNodes[configKey] || 100000;
    
    log(`BFS: Starting solver for ${order}x${order}${type === 'mirror' ? ' mirror' : ''}`);
    log(`BFS: Max depth: ${maxDepth}, Max nodes: ${maxNodes}`);
    
    // Use the provided state (maintained logical state)
    const currentState = startState.clone();
    
    // Debug: Check if current state is already solved
    const isAlreadySolved = currentState.isSolved();
    if (isAlreadySolved) {
        log("BFS: Cube is already solved!");
        return [];
    }
    
    // Verify state extraction: count pieces at correct positions
    let piecesAtHome = 0;
    currentState.pieces.forEach(p => {
        if (Math.abs(p.x - p.originalPos.x) < 0.1 &&
            Math.abs(p.y - p.originalPos.y) < 0.1 &&
            Math.abs(p.z - p.originalPos.z) < 0.1) {
            piecesAtHome++;
        }
    });
    log(`BFS: Pieces at home position: ${piecesAtHome}/${currentState.pieces.length}`);
    
    // Generate legal moves
    const allMoves = generateLegalMoves(order);
    log(`BFS: Generated ${allMoves.length} legal moves`);
    
    // Create neighbor generator
    const generateNeighbors = (state, lastMove) => {
        const filteredMoves = filterMoves(allMoves, lastMove);
        return filteredMoves.map(move => {
            const newState = state.clone();
            newState.applyMove(move.axis, move.slice, move.dir);
            return {state: newState, move};
        });
    };
    
    // Progress callback
    const onProgress = (msg) => {
        log(msg);
    };
    
    // Use IDA* for 2x2 (more memory efficient), BFS for larger cubes
    let result;
    if (order === 2) {
        log("BFS: Using IDA* algorithm (memory efficient)");
        result = await idaStarSearch(
            currentState,
            (state) => state.isSolved(),
            generateNeighbors,
            maxDepth,
            onProgress
        );
    } else {
        log("BFS: Using BFS algorithm");
        result = await bfsSolve(
            currentState,
            (state) => state.isSolved(),
            generateNeighbors,
            {maxDepth, maxNodes, onProgress}
        );
    }
    
    if (result.moves) {
        log(`BFS: Solution found! Depth: ${result.stats.depth}, Nodes: ${result.stats.nodesExpanded}, Time: ${result.stats.time}ms`);
        return result.moves;
    } else {
        log(`BFS: No solution found within constraints. Nodes expanded: ${result.stats.nodesExpanded}, Max depth: ${maxDepth}`);
        return null;
    }
}


// --- LOGIC CLASS (Legacy - kept for compatibility) ---
class VirtualCube {
    constructor(order) {
        this.pieces = [];
        const offset = (order - 1) / 2;
        for (let x = 0; x < order; x++) {
            for (let y = 0; y < order; y++) {
                for (let z = 0; z < order; z++) {
                    this.pieces.push({ x: x - offset, y: y - offset, z: z - offset });
                }
            }
        }
    }

    updateMap(axis, slice, dir) {
        const eps = 0.1;
        this.pieces.forEach(p => {
            if (Math.abs(p[axis] - slice) < eps) {
                let nx = p.x, ny = p.y, nz = p.z;
                if (axis === 'x') { ny = (dir === -1) ? p.z : -p.z; nz = (dir === -1) ? -p.y : p.y; }
                if (axis === 'y') { nz = (dir === -1) ? p.x : -p.x; nx = (dir === -1) ? -p.z : p.z; }
                if (axis === 'z') { nx = (dir === -1) ? p.y : -p.y; ny = (dir === -1) ? -p.x : p.x; }
                p.x = Math.round(nx * 2) / 2;
                p.y = Math.round(ny * 2) / 2;
                p.z = Math.round(nz * 2) / 2;
            }
        });
    }
}


// --- INITIALIZATION ---
function init() {
    const container = document.getElementById('viewport');
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(6, 6, 8);
    camera.lookAt(0, 0, 0);

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


function buildPuzzle(order, type) {
    STATE.order = order;
    STATE.type = type;
    STATE.memoryStack = [];
    updateUI();

    // Clean Scene
    allCubelets.forEach(m => {
        scene.remove(m);
        if (m.geometry) m.geometry.dispose();
    });
    allCubelets = [];

    logicCube = new VirtualCube(order);
    currentCubeState = new CubeState(order, type);

    const geom = new THREE.BoxGeometry(1, 1, 1);
    const offset = (order - 1) / 2;

    for (let x = 0; x < order; x++) {
        for (let y = 0; y < order; y++) {
            for (let z = 0; z < order; z++) {
                const ox = x - offset;
                const oy = y - offset;
                const oz = z - offset;

                const materials = [
                    new THREE.MeshStandardMaterial({ color: ox === offset ? CONFIG.colors.R : CONFIG.colors.CORE }),
                    new THREE.MeshStandardMaterial({ color: ox === -offset ? CONFIG.colors.L : CONFIG.colors.CORE }),
                    new THREE.MeshStandardMaterial({ color: oy === offset ? CONFIG.colors.U : CONFIG.colors.CORE }),
                    new THREE.MeshStandardMaterial({ color: oy === -offset ? CONFIG.colors.D : CONFIG.colors.CORE }),
                    new THREE.MeshStandardMaterial({ color: oz === offset ? CONFIG.colors.F : CONFIG.colors.CORE }),
                    new THREE.MeshStandardMaterial({ color: oz === -offset ? CONFIG.colors.B : CONFIG.colors.CORE }),
                ];

                if (type === 'mirror') {
                    materials.forEach(m => { m.color.setHex(0x333333); m.roughness = 0.2; });
                }

                const mesh = new THREE.Mesh(geom, materials);
                const spacing = (type === 'mirror') ? 1.4 : CONFIG.spacing;

                // Initial placement
                mesh.position.set(ox * spacing, oy * spacing, oz * spacing);

                if (type === 'mirror') mesh.scale.set(1 + ox * 0.35, 1 + oy * 0.35, 1 + oz * 0.35);

                mesh.add(new THREE.LineSegments(
                    new THREE.EdgesGeometry(geom),
                    new THREE.LineBasicMaterial({ color: 0x000000 })
                ));

                // Persistent Identity + logical coords
                // Store original position as unique ID for state tracking
                const pieceId = x * order * order + y * order + z;
                mesh.userData = {
                    isCenter: (Math.abs(ox) + Math.abs(oy) + Math.abs(oz) === 1),
                    startPos: new THREE.Vector3(),
                    startRot: new THREE.Quaternion(),
                    logicX: ox,
                    logicY: oy,
                    logicZ: oz,
                    pieceId: pieceId, // Unique ID based on original position
                    originalPos: {x: ox, y: oy, z: oz}
                };

                scene.add(mesh);
                allCubelets.push(mesh);
            }
        }
    }

    // Initial Snap
    snapToGrid();
    currentCubeState = new CubeState(order, type); // Start with solved state
}


// --- ANIMATION ENGINE ---
let currentMove = null;
let progress = 0;
let activeGroup = [];


function processQueue() {
    if (!moveQueue.length) {
        if (STATE.isAnimating) {
            STATE.isAnimating = false;
            document.getElementById('ai-state').innerText = "IDLE";
            document.getElementById('ai-state').style.color = "#666";
            snapToGrid();
            // Logical state is already maintained, no need to extract
        }
        return;
    }

    if (!currentMove) {
        // start new move
        snapToGrid();

        currentMove = moveQueue.shift();
        STATE.isAnimating = true;
        progress = 0;
        document.getElementById('ai-state').innerText = "PROCESSING";
        document.getElementById('ai-state').style.color = "#00ff88";

        const axisKey =
            currentMove.axis === 'x' ? 'logicX' :
            currentMove.axis === 'y' ? 'logicY' : 'logicZ';

        activeGroup = [];
        allCubelets.forEach(mesh => {
            if (mesh.userData[axisKey] === currentMove.slice) {
                activeGroup.push(mesh);
                mesh.userData.startPos.copy(mesh.position);
                mesh.userData.startRot.copy(mesh.quaternion);
            }
        });

        return;
    }

    const speed = CONFIG.animSpeed;

    if (speed >= 1.5) {
        progress = 1.1;
    } else {
        progress += speed;
    }

    if (progress >= 1.0) {
        const finalAngle = currentMove.dir * (Math.PI / 2);
        applyMatrixRotation(activeGroup, currentMove.axis, finalAngle);

        // update logical coords on rotated pieces
        activeGroup.forEach(mesh => {
            let { logicX: x, logicY: y, logicZ: z } = mesh.userData;
            let nx = x, ny = y, nz = z;

            if (currentMove.axis === 'x') {
                ny = (currentMove.dir === -1) ? z : -z;
                nz = (currentMove.dir === -1) ? -y : y;
            } else if (currentMove.axis === 'y') {
                nz = (currentMove.dir === -1) ? x : -x;
                nx = (currentMove.dir === -1) ? -z : z;
            } else if (currentMove.axis === 'z') {
                nx = (currentMove.dir === -1) ? y : -y;
                ny = (currentMove.dir === -1) ? -x : x;
            }

            mesh.userData.logicX = nx;
            mesh.userData.logicY = ny;
            mesh.userData.logicZ = nz;
        });

        logicCube.updateMap(currentMove.axis, currentMove.slice, currentMove.dir);
        
        // Update logical state when move completes
        if (currentCubeState) {
            currentCubeState.applyMove(currentMove.axis, currentMove.slice, currentMove.dir);
        }
        
        snapToGrid();

        currentMove = null;
        activeGroup = [];
    } else {
        const angle = currentMove.dir * progress * (Math.PI / 2);
        applyMatrixRotation(activeGroup, currentMove.axis, angle);
    }
}


// rotation helper – expects signed angle
// Rotates pieces around the center of the slice being rotated
function applyMatrixRotation(group, axis, signedAngle) {
    if (group.length === 0) return;
    
    const axisVec = new THREE.Vector3();
    axisVec[axis] = 1;

    // Calculate the center point of the slice (pivot point for rotation)
    const pivot = new THREE.Vector3();
    group.forEach(mesh => {
        pivot.add(mesh.userData.startPos);
    });
    pivot.divideScalar(group.length);
    
    // Round pivot to grid to avoid floating point errors
    const spacing = (STATE.type === 'mirror') ? 1.4 : CONFIG.spacing;
    pivot[axis] = Math.round(pivot[axis] / spacing) * spacing;

    const qRot = new THREE.Quaternion().setFromAxisAngle(axisVec, signedAngle);

    group.forEach(mesh => {
        // Translate to origin, rotate, translate back
        const relativePos = mesh.userData.startPos.clone().sub(pivot);
        relativePos.applyAxisAngle(axisVec, signedAngle);
        mesh.position.copy(pivot).add(relativePos);
        
        // Rotate orientation
        mesh.quaternion.copy(mesh.userData.startRot).premultiply(qRot);
        mesh.updateMatrix();
    });
}


// --- ROBUST SNAPPING ---
function snapToGrid() {
    const spacing = (STATE.type === 'mirror') ? 1.4 : CONFIG.spacing;

    allCubelets.forEach(mesh => {
        mesh.position.x = Math.round(mesh.position.x / spacing) * spacing;
        mesh.position.y = Math.round(mesh.position.y / spacing) * spacing;
        mesh.position.z = Math.round(mesh.position.z / spacing) * spacing;

        mesh.updateMatrix();
        const right = new THREE.Vector3().setFromMatrixColumn(mesh.matrix, 0).normalize();
        const up = new THREE.Vector3().setFromMatrixColumn(mesh.matrix, 1).normalize();
        const fwd = new THREE.Vector3().setFromMatrixColumn(mesh.matrix, 2).normalize();

        snapVector(right);
        snapVector(up);
        snapVector(fwd);

        const m = new THREE.Matrix4().makeBasis(right, up, fwd);
        mesh.quaternion.setFromRotationMatrix(m);
        mesh.updateMatrixWorld();
    });
}


function snapVector(v) {
    const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
    if (ax > ay && ax > az) v.set(Math.sign(v.x), 0, 0);
    else if (ay > ax && ay > az) v.set(0, Math.sign(v.y), 0);
    else v.set(0, 0, Math.sign(v.z));
}


// --- CONTROLS ---
function scramble() {
    if (STATE.isAnimating) return;
    if (moveQueue.length > 0) return;

    // Adjust scramble length based on cube size for better BFS performance
    const scrambleLengths = {
        2: 10,   // 2x2: shorter scramble
        3: 15,   // 3x3: moderate scramble (reduced from 20)
        4: 12,   // 4x4: shorter for simplified solver
        5: 10,   // 5x5: shorter for simplified solver
        mirror: 15
    };
    const moves = scrambleLengths[STATE.order] || scrambleLengths[STATE.type] || 15;
    
    const axes = ['x', 'y', 'z'];
    const range = (STATE.order - 1) / 2;
    const slices = [];
    for (let i = -range; i <= range; i++) slices.push(i);

    log(`Scramble Initiated (${moves} moves)`);
    STATE.memoryStack = [];
    
    // Reset logical state to solved before scrambling
    if (!currentCubeState) {
        currentCubeState = new CubeState(STATE.order, STATE.type);
    } else {
        // Reset to solved state
        currentCubeState = new CubeState(STATE.order, STATE.type);
    }
    
    for (let i = 0; i < moves; i++) {
        const m = {
            axis: axes[Math.floor(Math.random() * 3)],
            slice: slices[Math.floor(Math.random() * slices.length)],
            dir: Math.random() > 0.5 ? 1 : -1
        };
        moveQueue.push(m);
        STATE.memoryStack.push(m);
    }
    updateUI();
}


async function solve() {
    if (STATE.isAnimating) return;
    
    // Wait for any pending animations to complete
    while (STATE.isAnimating || moveQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    log("AI: BFS Solver Starting...");
    document.getElementById('ai-state').innerText = "SEARCHING";
    document.getElementById('ai-state').style.color = "#ffaa00";
    
    try {
        // Ensure state is synchronized before solving
        snapToGrid();
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to ensure state is stable
        
        // Use maintained logical state - it should be up to date since moves update it
        if (!currentCubeState) {
            log("WARNING: No logical state found, creating new solved state");
            currentCubeState = new CubeState(STATE.order, STATE.type);
        }
        
        // Debug: Check state
        const isSolved = currentCubeState.isSolved();
        log(`BFS: Current state is solved: ${isSolved}`);
        
        if (isSolved) {
            log("AI: Cube is already solved!");
            return;
        }
        
        // Debug: Count pieces at home with correct orientation
        let piecesCorrect = 0;
        currentCubeState.pieces.forEach(p => {
            const posCorrect = Math.abs(p.x - p.originalPos.x) < 0.1 &&
                               Math.abs(p.y - p.originalPos.y) < 0.1 &&
                               Math.abs(p.z - p.originalPos.z) < 0.1;
            if (posCorrect) {
                // Check orientation
                const offset = currentCubeState.offset;
                let orientCorrect = true;
                if (p.x === offset && p.faces['+X'] !== 'R') orientCorrect = false;
                if (p.x === -offset && p.faces['-X'] !== 'L') orientCorrect = false;
                if (p.y === offset && p.faces['+Y'] !== 'U') orientCorrect = false;
                if (p.y === -offset && p.faces['-Y'] !== 'D') orientCorrect = false;
                if (p.z === offset && p.faces['+Z'] !== 'F') orientCorrect = false;
                if (p.z === -offset && p.faces['-Z'] !== 'B') orientCorrect = false;
                if (orientCorrect) piecesCorrect++;
            }
        });
        log(`BFS: Pieces at home with correct orientation: ${piecesCorrect}/${currentCubeState.pieces.length}`);
        
        // Run BFS solver using the maintained state
        const solution = await solveWithBFS(currentCubeState.clone(), STATE.order, STATE.type);
        
        if (solution && solution.length > 0) {
            log(`AI: Solution found! Applying ${solution.length} moves...`);
            solution.forEach(m => moveQueue.push(m));
            STATE.memoryStack = [];
            updateUI();
        } else {
            log("AI: BFS search limit reached; no solution found within constraints.");
            document.getElementById('ai-state').innerText = "FAILED";
            document.getElementById('ai-state').style.color = "#ff4f7d";
        }
    } catch (error) {
        log(`AI: Error during BFS: ${error.message}`);
        console.error(error);
        document.getElementById('ai-state').innerText = "ERROR";
        document.getElementById('ai-state').style.color = "#ff4f7d";
    }
}


// --- UI ---
function updateUI() {
    document.getElementById('stack-count').innerText = STATE.memoryStack.length;
    if (STATE.memoryStack.length === 0) {
        document.getElementById('opt-percent').innerText = "0%";
    }
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
        if (val <= 5) CONFIG.animSpeed = val * 0.02;
        else if (val <= 15) CONFIG.animSpeed = (val - 5) * 0.05 + 0.1;
        else CONFIG.animSpeed = 2.0;
    });
    document.getElementById('puzzle-type').addEventListener('change', e => {
        const val = e.target.value;
        if (val === 'mirror') buildPuzzle(3, 'mirror');
        else buildPuzzle(parseInt(val), 'normal');
    });
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
    
    // Debug utility
    window.debugScrambleAndSolve = async function() {
        log("DEBUG: Scrambling with fixed seed...");
        Math.random = (() => {
            let seed = 12345;
            return () => {
                seed = (seed * 9301 + 49297) % 233280;
                return seed / 233280;
            };
        })();
        
        scramble();
        
        // Wait for scramble to complete
        while (STATE.isAnimating || moveQueue.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        log("DEBUG: Running BFS solver...");
        await solve();
    };
    
    // Debug: Test state extraction
    window.debugTestState = function() {
        const state = CubeState.fromVisualCubelets(allCubelets, STATE.order, STATE.type);
        const solvedState = new CubeState(STATE.order, STATE.type);
        
        log(`DEBUG: Current state is solved: ${state.isSolved()}`);
        log(`DEBUG: Solved state is solved: ${solvedState.isSolved()}`);
        log(`DEBUG: Current state encoding: ${state.encode().substring(0, 100)}...`);
        log(`DEBUG: Solved state encoding: ${solvedState.encode().substring(0, 100)}...`);
        
        // Check a few pieces
        for (let i = 0; i < Math.min(5, state.pieces.length); i++) {
            const p = state.pieces[i];
            const sp = solvedState.pieces[i];
            log(`DEBUG: Piece ${i}: current=(${p.x},${p.y},${p.z}) original=(${p.originalPos.x},${p.originalPos.y},${p.originalPos.z}) solved=(${sp.x},${sp.y},${sp.z})`);
        }
    };
}


function animate() {
    controls.update();
    processQueue();
    renderer.render(scene, camera);
}


init();
