import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.0.0'

// Define the type for the incoming request body
interface RequestBody {
  patterns: string[];
  gameWinner: 'black' | 'white';
  aiPlayer: 'black' | 'white';
}

serve(async (req) => {
  // 1. Validate request
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const { patterns, gameWinner, aiPlayer }: RequestBody = await req.json();

    if (!patterns || !gameWinner || !aiPlayer) {
      return new Response('Missing required fields', { status: 400 });
    }

    // 2. Create a Supabase admin client to bypass RLS
    const supabaseAdminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    // 3. Determine if the AI won
    const didAiWin = gameWinner === aiPlayer;

    // 4. Loop through each pattern and upsert its win/loss count
    for (const hash of patterns) {
      // Use an RPC function to handle the atomic increment
      // This is safer than read-then-write in a concurrent environment
      const { error } = await supabaseAdminClient.rpc('update_pattern_knowledge', {
        p_pattern_hash: hash,
        p_wins_increment: didAiWin ? 1 : 0,
        p_losses_increment: didAiWin ? 0 : 1
      });

      if (error) {
        console.error(`Error updating pattern ${hash}:`, error);
        // Decide if you want to stop on first error or continue
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('General error in edge function:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
})