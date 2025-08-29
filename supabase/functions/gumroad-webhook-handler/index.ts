import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPPORTER_PRODUCT_ID = 'pro_01k3r4rdae9qz68ys1vwag88b0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const userAgent = req.headers.get('User-Agent') || '';
    if (!userAgent.includes('Gumroad')) {
      return new Response('Invalid request origin.', { status: 400 });
    }

    const payload = await req.json();

    if (payload.product_id !== SUPPORTER_PRODUCT_ID) {
      return new Response('Notification for irrelevant product.', { status: 200 });
    }

    const email = payload.email;
    if (!email) {
      throw new Error('Email not found in Gumroad payload.');
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Step 1: Call the database function to get the user ID from the email
    const { data: userId, error: rpcError } = await supabaseAdmin.rpc('get_user_id_by_email', {
      user_email: email
    });

    if (rpcError || !userId) {
      throw new Error(`Could not find user with email: ${email}. Error: ${rpcError?.message}`);
    }

    console.log(`Found user ID: ${userId} for email: ${email}`);

    // Step 2: Update the user's profile to grant supporter status
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ is_supporter: true })
      .eq('id', userId);

    if (profileError) {
      throw new Error(`Failed to update profile for user ${userId}: ${profileError.message}`);
    }

    console.log(`Successfully granted supporter status to user: ${userId}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (e) {
    console.error("Error in Gumroad webhook handler:", e);
    const errorMessage = e instanceof Error ? e.message : "An unexpected error occurred.";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
