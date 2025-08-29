import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'

const BOARD_SIZE = 19;

// --- AI Logic ---
const checkWin = (board: any[][], player: any, row: number, col: number) => {
  const directions = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: -1 }];
  for (const dir of directions) {
    let count = 1;
    for (let i = 1; i < 5; i++) {
      const newRow = row + i * dir.y; const newCol = col + i * dir.x;
      if (newRow < 0 || newRow >= BOARD_SIZE || newCol < 0 || newCol >= BOARD_SIZE || board[newRow][newCol] !== player) break;
      count++;
    }
    for (let i = 1; i < 5; i++) {
      const newRow = row - i * dir.y; const newCol = col - i * dir.x;
      if (newRow < 0 || newRow >= BOARD_SIZE || newCol < 0 || newCol >= BOARD_SIZE || board[newRow][newCol] !== player) break;
      count++;
    }
    if (count >= 5) return true;
  }
  return false;
};

function getPossibleMoves(board: any[][]) {
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
    if (!hasStones) {
        return [[Math.floor(BOARD_SIZE / 2), Math.floor(BOARD_SIZE / 2)]];
    }
    return Array.from(moves).map(move => {
        const [r, c] = move.split(',').map(Number);
        return [r, c];
    });
}

const HEURISTIC_SCORE = {
    FIVE: 100000, OPEN_FOUR: 10000, CLOSED_FOUR: 1000,
    OPEN_THREE: 500, CLOSED_THREE: 10, OPEN_TWO: 5, CLOSED_TWO: 1,
};

function evaluateLine(line: any[], player: any) {
    const opponent = player === 'black' ? 'white' : 'black';
    let score = 0;
    const playerCount = line.filter(cell => cell === player).length;
    const emptyCount = line.filter(cell => cell === null).length;
    if (playerCount === 5) return HEURISTIC_SCORE.FIVE;
    if (playerCount === 4 && emptyCount === 1) score += HEURISTIC_SCORE.OPEN_FOUR;
    if (playerCount === 3 && emptyCount === 2) score += HEURISTIC_SCORE.OPEN_THREE;
    if (playerCount === 2 && emptyCount === 3) score += HEURISTIC_SCORE.OPEN_TWO;
    const opponentCount = line.filter(cell => cell === opponent).length;
    if (opponentCount === 5) return -HEURISTIC_SCORE.FIVE;
    if (opponentCount === 4 && emptyCount === 1) score -= HEURISTIC_SCORE.OPEN_FOUR * 1.5;
    if (opponentCount === 3 && emptyCount === 2) score -= HEURISTIC_SCORE.OPEN_THREE * 1.5;
    return score;
}

function evaluateBoard(board: any[][], player: any) {
    let totalScore = 0;
    for (let r = 0; r < BOARD_SIZE; r++) { for (let c = 0; c <= BOARD_SIZE - 5; c++) { totalScore += evaluateLine(board[r].slice(c, c + 5), player); } }
    for (let c = 0; c < BOARD_SIZE; c++) { for (let r = 0; r <= BOARD_SIZE - 5; r++) { const line = []; for (let i = 0; i < 5; i++) line.push(board[r + i][c]); totalScore += evaluateLine(line, player); } }
    for (let r = 0; r <= BOARD_SIZE - 5; r++) { for (let c = 0; c <= BOARD_SIZE - 5; c++) { const line = []; for (let i = 0; i < 5; i++) line.push(board[r + i][c + i]); totalScore += evaluateLine(line, player); } }
    for (let r = 0; r <= BOARD_SIZE - 5; r++) { for (let c = 4; c < BOARD_SIZE; c++) { const line = []; for (let i = 0; i < 5; i++) line.push(board[r + i][c - i]); totalScore += evaluateLine(line, player); } }
    return totalScore;
}

function minimax(board: any[][], depth: number, alpha: number, beta: number, maximizingPlayer: boolean, aiPlayer: any) {
    if (depth === 0) { return evaluateBoard(board, aiPlayer); }
    const possibleMoves = getPossibleMoves(board);
    const humanPlayer = aiPlayer === 'black' ? 'white' : 'black';
    if (maximizingPlayer) {
        let maxEval = -Infinity;
        for (const [r, c] of possibleMoves) {
            const newBoard = board.map(row => [...row]);
            newBoard[r][c] = aiPlayer;
            const evaluation = minimax(newBoard, depth - 1, alpha, beta, false, aiPlayer);
            maxEval = Math.max(maxEval, evaluation);
            alpha = Math.max(alpha, evaluation);
            if (beta <= alpha) break;
        }
        return maxEval;
    } else {
        let minEval = Infinity;
        for (const [r, c] of possibleMoves) {
            const newBoard = board.map(row => [...row]);
            newBoard[r][c] = humanPlayer;
            const evaluation = minimax(newBoard, depth - 1, alpha, beta, true, aiPlayer);
            minEval = Math.min(minEval, evaluation);
            beta = Math.min(beta, evaluation);
            if (beta <= alpha) break;
        }
        return minEval;
    }
}

async function findBestMove(board: any[][], player: any, supabase: SupabaseClient) {
    const opponent = player === 'black' ? 'white' : 'black';
    let possibleMoves = getPossibleMoves(board);

    if (possibleMoves.length === 0) return [-1, -1];

    // Check for immediate win/loss first to save computation
    for (const [r, c] of possibleMoves) {
        const newBoard = board.map(row => [...row]);
        newBoard[r][c] = player;
        if (checkWin(newBoard, player, r, c)) return [r, c];
    }
    for (const [r, c] of possibleMoves) {
        const newBoard = board.map(row => [...row]);
        newBoard[r][c] = opponent;
        if (checkWin(newBoard, opponent, r, c)) return [r, c];
    }

    // --- Move Ordering using Learned Knowledge ---
    try {
        const moveHashes = possibleMoves.map(([r, c]) => {
            const newBoard = board.map(row => [...row]);
            newBoard[r][c] = player;
            return boardToString(newBoard);
        });

        const { data: knowledge, error } = await supabase
            .from('ai_pattern_knowledge')
            .select('pattern_hash, wins, losses')
            .in('pattern_hash', moveHashes);

        if (error) {
            console.error("Error fetching pattern knowledge, proceeding without it:", error.message);
        } else if (knowledge) {
            const knowledgeMap = new Map<string, { wins: number, losses: number }>();
            for (const record of knowledge) {
                knowledgeMap.set(record.pattern_hash, { wins: record.wins, losses: record.losses });
            }

            possibleMoves.sort((moveA, moveB) => {
                const boardA = board.map(row => [...row]);
                boardA[moveA[0]][moveA[1]] = player;
                const hashA = boardToString(boardA);

                const boardB = board.map(row => [...row]);
                boardB[moveB[0]][moveB[1]] = player;
                const hashB = boardToString(boardB);

                const statsA = knowledgeMap.get(hashA) || { wins: 0, losses: 0 };
                const statsB = knowledgeMap.get(hashB) || { wins: 0, losses: 0 };

                // Using Laplace smoothing to avoid division by zero and handle unseen patterns
                const scoreA = (statsA.wins + 1) / (statsA.wins + statsA.losses + 2);
                const scoreB = (statsB.wins + 1) / (statsB.wins + statsB.losses + 2);

                return scoreB - scoreA; // Sort descending by win rate
            });
            console.log("Move ordering enhanced by learned knowledge.");
        }
    } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error("An unexpected error occurred during move ordering:", errorMessage);
    }
    // --- End of Move Ordering ---

    let bestVal = -Infinity;
    let bestMove = possibleMoves[0] || [-1, -1];
    const searchDepth = 2;

    for (const [r, c] of possibleMoves) {
        const newBoard = board.map(row => [...row]);
        newBoard[r][c] = player;
        const moveVal = minimax(newBoard, searchDepth, -Infinity, Infinity, false, player);
        if (moveVal > bestVal) {
            bestMove = [r, c];
            bestVal = moveVal;
        }
    }
    return bestMove;
}


const boardToString = (board: any[][]) => board.map(row => row.map(cell => cell ? (cell === 'black' ? 'b' : 'w') : '-').join('')).join('|');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { board, player, moves } = await req.json()

    if (!board || !player) {
      throw new Error("Missing 'board' or 'player' in request body.");
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: { persistSession: false }
      }
    );

    // Step 1: Check the Opening Book
    if (moves.length <= 10) {
      const boardHash = boardToString(board);
      const { data: openingMove, error: bookError } = await supabaseAdmin
        .from('ai_opening_book')
        .select('best_move')
        .eq('board_hash', boardHash)
        .single();

      if (bookError && bookError.code !== 'PGRST116') {
        console.error("Error querying opening book, proceeding with calculation:", bookError.message);
      }

      if (openingMove && openingMove.best_move) {
        const [r, c] = openingMove.best_move;
        if (board[r][c] === null) {
          console.log("Found move in Opening Book:", openingMove.best_move);
          return new Response(JSON.stringify({ move: openingMove.best_move }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          });
        } else {
            console.warn("Opening book move is invalid, recalculating:", openingMove.best_move)
        }
      }
    }

    // Step 2: If no book entry, calculate the move using learned knowledge for move ordering
    console.log("Calculating move with knowledge-based move ordering...");
    const bestMove = await findBestMove(board, player, supabaseAdmin);

    return new Response(JSON.stringify({ move: bestMove }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred in get-ai-move function.";
    console.error("Error in get-ai-move function:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
