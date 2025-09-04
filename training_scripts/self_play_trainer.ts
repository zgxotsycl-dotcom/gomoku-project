import 'https://deno.land/std@0.224.0/dotenv/load.ts';

// --- Configuration ---
const NUM_WORKERS = 8; // Number of parallel games to run
const BATCH_SUBMIT_INTERVAL = 60000; // Submit data every 60 seconds
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// --- Batching Accumulators ---
let knowledgeBatch = {
  black_wins: new Set<string>(),
  black_losses: new Set<string>(),
  white_wins: new Set<string>(),
  white_losses: new Set<string>(),
};

// --- Submission Logic ---
async function submitBatch() {
  console.log('Starting batch submission...');
  const batchToSubmit = { ...knowledgeBatch };
  
  // Reset global batch immediately
  knowledgeBatch = {
    black_wins: new Set<string>(),
    black_losses: new Set<string>(),
    white_wins: new Set<string>(),
    white_losses: new Set<string>(),
  };

  const submissions = [
    { perspective: 'black', won: true, patterns: Array.from(batchToSubmit.black_wins) },
    { perspective: 'black', won: false, patterns: Array.from(batchToSubmit.black_losses) },
    { perspective: 'white', won: true, patterns: Array.from(batchToSubmit.white_wins) },
    { perspective: 'white', won: false, patterns: Array.from(batchToSubmit.white_losses) },
  ];

  for (const sub of submissions) {
    if (sub.patterns.length === 0) continue;

    console.log(`Submitting ${sub.patterns.length} patterns for perspective: ${sub.perspective}, won: ${sub.won}`);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/update-ai-knowledge`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        // The edge function expects aiPlayer and gameWinner, we simulate this
        body: JSON.stringify({ 
          patterns: sub.patterns, 
          gameWinner: sub.won ? sub.perspective : (sub.perspective === 'black' ? 'white' : 'black'), 
          aiPlayer: sub.perspective
        })
      });

      if (!res.ok) {
        console.error(`Error submitting batch for ${sub.perspective}/${sub.won}: ${await res.text()}`);
      } else {
        console.log(`Successfully submitted batch for ${sub.perspective}/${sub.won}.`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Failed to submit batch for ${sub.perspective}/${sub.won}:`, errorMessage);
    }
  }
}

// --- Main Worker Manager Logic ---
async function runParallelSelfPlay() {
  console.log(`Starting parallel training with ${NUM_WORKERS} workers.`);
  let totalGamesPlayed = 0;

  // Set up the periodic batch submission
  setInterval(submitBatch, BATCH_SUBMIT_INTERVAL);

  const startWorker = (workerId: number) => {
    const worker = new Worker(new URL("./game_worker.ts", import.meta.url).href, { type: "module" });

    worker.onmessage = async (e) => {
      const { boardHashes, winner } = e.data;
      totalGamesPlayed++;
      console.log(`Game ${totalGamesPlayed} finished. Winner: ${winner || 'Draw'}. Accumulating knowledge...`);

      if (winner && boardHashes) {
        if (winner === 'black') {
          boardHashes.forEach((hash: string) => knowledgeBatch.black_wins.add(hash));
          boardHashes.forEach((hash: string) => knowledgeBatch.white_losses.add(hash));
        } else if (winner === 'white') {
          boardHashes.forEach((hash: string) => knowledgeBatch.white_wins.add(hash));
          boardHashes.forEach((hash: string) => knowledgeBatch.black_losses.add(hash));
        }
      }
      
      // Start a new game immediately
      worker.postMessage({});
    };

    worker.onerror = (err) => {
      const errorMessage = err instanceof ErrorEvent ? err.message : 'An unknown worker error occurred';
      console.error(`Worker ${workerId} error:`, errorMessage, err);
    };

    // Initial start of the worker
    worker.postMessage({});
  };

  // Create and start the pool of workers
  for (let i = 0; i < NUM_WORKERS; i++) {
    startWorker(i + 1);
  }

  // Keep the main script alive indefinitely
  await new Promise(() => {});
}

// --- Run Script ---
runParallelSelfPlay().catch(e => console.error("A critical error occurred in the self-play manager:", e));
