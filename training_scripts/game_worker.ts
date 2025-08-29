import { createClient } from '@supabase/supabase-js';

// This script is a self-contained worker for playing a single game of Gomoku using MCTS.

self.onmessage = async (e) => {
    const { supabaseUrl, supabaseServiceKey } = e.data;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- MCTS Implementation ---
    const BOARD_SIZE = 19;
    const MCTS_ITERATIONS_DEFAULT = 1000;
    const MCTS_ITERATIONS_CRITICAL = 5000;
    const MCTS_ITERATIONS_FORCED = 200;
    const C_PARAM = Math.sqrt(2); // Exploration parameter
    const directions = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: -1 }];

    // --- Forbidden Move (Kinsu) Logic ---
    const countStones = (board: any[][], r: number, c: number, dr: number, dc: number, player: string) => {
        let count = 0;
        for (let i = 1; i < 7; i++) {
            const nr = r + i * dr;
            const nc = c + i * dc;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || board[nr][nc] !== player) break;
            count++;
        }
        return count;
    };

    const isOverline = (board: any[][], r: number, c: number) => {
        board[r][c] = 'black';
        for (const dir of directions) {
            const count = 1 + countStones(board, r, c, dir.x, dir.y, 'black') + countStones(board, r, c, -dir.x, -dir.y, 'black');
            if (count > 5) {
                board[r][c] = null; // Revert change
                return true;
            }
        }
        board[r][c] = null; // Revert change
        return false;
    };

    const countOpenThreesAndFours = (board: any[][], r: number, c: number) => {
        let openThrees = 0;
        let fours = 0;
        board[r][c] = 'black';

        for (const dir of directions) {
            const count = 1 + countStones(board, r, c, dir.x, dir.y, 'black') + countStones(board, r, c, -dir.x, -dir.y, 'black');
            if (count === 4) fours++;

            const p1 = board[r + dir.x]?.[c + dir.y];
            const p2 = board[r + 2 * dir.x]?.[c + 2 * dir.y];
            const m1 = board[r - dir.x]?.[c - dir.y];
            const m2 = board[r - 2 * dir.x]?.[c - 2 * dir.y];

            if(m1 === null && p1 === 'black' && p2 === 'black' && board[r+3*dir.x]?.[c+3*dir.y] === null) openThrees++; // _B_BB_
            if(m1 === 'black' && m2 === null && p1 === 'black' && p2 === null) openThrees++; // _B_B_B_
        }

        board[r][c] = null; // Revert change
        return { openThrees, fours };
    };

    const isForbidden = (board: any[][], r: number, c: number) => {
        if (board[r][c] !== null) return false;
        if (isOverline(board, r, c)) return true;
        const { openThrees, fours } = countOpenThreesAndFours(board, r, c);
        if (openThrees >= 2 || fours >= 2) return true;
        return false;
    };

    // --- MCTS Node ---
    class MCTSNode {
        parent: MCTSNode | null;
        children: MCTSNode[];
        visits: number;
        wins: number;
        board: any[][];
        player: string;
        move: number[] | null;
        unexploredMoves: {move: number[], prior: number}[];

        constructor(board: any[][], player: string, parent: MCTSNode | null = null, move: number[] | null = null, priors: Map<string, number> = new Map()) {
            this.parent = parent;
            this.board = board;
            this.player = player;
            this.move = move;
            this.children = [];
            this.visits = 0;
            this.wins = 0;
            const possibleMoves = getPossibleMoves(this.board, this.player);
            this.unexploredMoves = possibleMoves.map(m => ({ move: m, prior: priors.get(m.join(',')) || 0.5 }));
            this.unexploredMoves.sort((a, b) => b.prior - a.prior); // Sort by prior probability
        }

        isFullyExpanded() { return this.unexploredMoves.length === 0; }

        selectBestChild(): MCTSNode {
            let bestScore = -Infinity;
            let bestChild: MCTSNode | null = null;
            for (const child of this.children) {
                const score = (child.wins / child.visits) + C_PARAM * Math.sqrt(Math.log(this.visits) / child.visits);
                if (score > bestScore) { bestScore = score; bestChild = child; }
            }
            return bestChild!;
        }

        expand(): MCTSNode {
            const moveData = this.unexploredMoves.shift()!;
            const move = moveData.move;
            const newBoard = this.board.map(row => [...row]);
            newBoard[move[0]][move[1]] = this.player;
            const nextPlayer = this.player === 'black' ? 'white' : 'black';
            const childNode = new MCTSNode(newBoard, nextPlayer, this, move);
            this.children.push(childNode);
            return childNode;
        }

        simulate(): number {
            let tempBoard = this.board.map(row => [...row]);
            let currentPlayer = this.player;
            let terminalState = checkTerminalState(tempBoard);

            while (terminalState === null) {
                const moves = getPossibleMoves(tempBoard, currentPlayer);
                if (moves.length === 0) { terminalState = 0; break; }
                const randomMove = moves[Math.floor(Math.random() * moves.length)];
                tempBoard[randomMove[0]][randomMove[1]] = currentPlayer;
                terminalState = checkTerminalState(tempBoard, currentPlayer, randomMove[0], randomMove[1]);
                currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
            }

            if (terminalState === 0) return 0.5;
            if (terminalState === this.parent?.player) return 1;
            return 0;
        }

        backpropagate(result: number) {
            let node: MCTSNode | null = this;
            while (node !== null) {
                node.visits++;
                node.wins += result;
                result = 1 - result;
                node = node.parent;
            }
        }
    }

    const findBestMoveMCTS = async (board: any[][], player: string): Promise<number[]> => {
        let mcts_iterations = MCTS_ITERATIONS_DEFAULT;
        const immediateThreat = checkForOpenFour(board);
        if (immediateThreat) {
            return immediateThreat; // If there's a winning move, take it immediately.
        }
        
        // Fetch knowledge for root moves to guide the search
        const possibleMoves = getPossibleMoves(board, player);
        const moveHashes = possibleMoves.map(move => {
            const newBoard = board.map(row => [...row]);
            newBoard[move[0]][move[1]] = player;
            return boardToString(newBoard);
        });

        const priors = new Map<string, number>();
        try {
            const { data: knowledge } = await supabase.from('ai_knowledge').select('pattern_hash, wins, losses').in('pattern_hash', moveHashes);
            if (knowledge) {
                for (const record of knowledge) {
                    const winRate = (record.wins + 1) / (record.wins + record.losses + 2);
                    priors.set(record.pattern_hash, winRate);
                }
            }
        } catch(e) { console.error("Error fetching priors", e); }

        const root = new MCTSNode(board, player, null, null, priors);

        for (let i = 0; i < mcts_iterations; i++) {
            let node = root;
            while (node.isFullyExpanded() && node.children.length > 0) { node = node.selectBestChild(); }
            if (!node.isFullyExpanded()) { node = node.expand(); }
            const result = node.simulate();
            node.backpropagate(result);
        }

        let bestMove: number[] | null = null;
        let maxVisits = -1;
        for (const child of root.children) {
            if (child.visits > maxVisits) {
                maxVisits = child.visits;
                bestMove = child.move;
            }
        }
        return bestMove || possibleMoves[0]; // Fallback
    };

    // --- Helper functions ---
    const checkForOpenFour = (board: any[][]): number[] | null => {
        const players = ['black', 'white'];
        for (const player of players) {
            const moves = getPossibleMoves(board, player);
            for (const move of moves) {
                const [r, c] = move;
                board[r][c] = player;
                let isWin = false;
                for (const dir of directions) {
                    const count = 1 + countStones(board, r, c, dir.x, dir.y, player) + countStones(board, r, c, -dir.x, -dir.y, player);
                    if (count === 5) { isWin = true; break; }
                }
                board[r][c] = null; // revert
                if (isWin) return [r, c];
            }
        }
        return null;
    };

    const checkTerminalState = (board: any[][], player?: string, r?: number, c?: number): string | null | 0 => {
        if (player && r !== undefined && c !== undefined) {
            for (const dir of directions) {
                const count = 1 + countStones(board, r, c, dir.x, dir.y, player) + countStones(board, r, c, -dir.x, -dir.y, player);
                if (player === 'black' && count > 5) return 'white'; // Overline is a loss for black
                if (count === 5) return player;
            }
        }
        if (board.every(row => row.every(cell => cell !== null))) return 0;
        return null;
    };

    function getPossibleMoves(board: any[][], player: string) {
        const moves = new Set<string>();
        const radius = 1;
        let hasStones = false;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (board[r][c] !== null) {
                    hasStones = true;
                    for (let i = -radius; i <= radius; i++) {
                        for (let j = -radius; j <= radius; j++) {
                            const newR = r + i;
                            const newC = c + j;
                            if (newR >= 0 && newR < BOARD_SIZE && newC >= 0 && newC < BOARD_SIZE && board[newR][newC] === null) {
                                moves.add(`${newR},${newC}`);
                            }
                        }
                    }
                }
            }
        }
        if (!hasStones) return [[Math.floor(BOARD_SIZE / 2), Math.floor(BOARD_SIZE / 2)]];
        
        const validMoves = Array.from(moves).map(move => {
            const [r, c] = move.split(',').map(Number);
            return [r, c];
        });

        if (player === 'black') {
            return validMoves.filter(([r, c]) => !isForbidden(board, r, c));
        }
        return validMoves;
    }
    const boardToString = (board: any[][]) => board.map(row => row.map(cell => cell ? (cell === 'black' ? 'b' : 'w') : '-').join('')).join('|');

    // --- Game Simulation Logic ---
    let board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
    let currentPlayer = 'black';
    let moves = [];
    let boardHashes = new Set<string>();
    let winner: string | null | 0 = null;

    while (winner === null && moves.length < BOARD_SIZE * BOARD_SIZE) {
        const move = await findBestMoveMCTS(board, currentPlayer);
        if (!move) { winner = 0; break; }
        
        const [row, col] = move;
        
        if (currentPlayer === 'black' && isForbidden(board, row, col)) {
            winner = 'white';
            break;
        }

        board[row][col] = currentPlayer;
        moves.push([row, col]);
        boardHashes.add(boardToString(board));

        const terminalState = checkTerminalState(board, currentPlayer, row, col);
        if (terminalState !== null) {
            winner = terminalState;
            break;
        }
        currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
    }

    self.postMessage({ boardHashes: Array.from(boardHashes), winner: winner === 0 ? 'Draw' : winner });
};