import 'https://deno.land/std@0.224.0/dotenv/load.ts';

// --- Configuration ---
const NUM_WORKERS = 6; // Number of parallel games to run
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// --- Main Worker Manager Logic ---
async function runParallelSelfPlay() {
  console.log(`Starting parallel training with ${NUM_WORKERS} workers.`);
  let totalGamesPlayed = 0;

  const startWorker = (workerId: number) => {
    const worker = new Worker(new URL("./game_worker.ts", import.meta.url).href, { type: "module" });

    worker.onmessage = async (e) => {
      const { boardHashes, winner } = e.data;
      totalGamesPlayed++;
      console.log(`Game ${totalGamesPlayed} finished. Winner: ${winner || 'Draw'}. Submitting knowledge...`);

      if (winner) {
        try {
          const resBlack = await fetch(`${SUPABASE_URL}/functions/v1/update-ai-knowledge`, {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({ patterns: boardHashes, gameWinner: winner, aiPlayer: 'black' })
          });
          if (!resBlack.ok) console.error(`Error submitting black's perspective: ${await resBlack.text()}`);

          const resWhite = await fetch(`${SUPABASE_URL}/functions/v1/update-ai-knowledge`, {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({ patterns: boardHashes, gameWinner: winner, aiPlayer: 'white' })
          });
          if (!resWhite.ok) console.error(`Error submitting white's perspective: ${await resWhite.text()}`);

          if(resBlack.ok && resWhite.ok) {
            console.log(`Successfully submitted knowledge for game ${totalGamesPlayed}.`);
          }

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error(`Failed to submit game knowledge for game ${totalGamesPlayed}:`, errorMessage);
        }
      }
      
      // Start a new game immediately
      worker.postMessage({ supabaseUrl: SUPABASE_URL, supabaseServiceKey: SUPABASE_SERVICE_KEY });
    };

    worker.onerror = (err) => {
      console.error(`Worker ${workerId} error:`, err.message);
    };

    // Initial start of the worker
    worker.postMessage({ supabaseUrl: SUPABASE_URL, supabaseServiceKey: SUPABASE_SERVICE_KEY });
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