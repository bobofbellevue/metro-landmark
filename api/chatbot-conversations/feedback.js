import { createClient } from '@supabase/supabase-js';

export default async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Support both old (SUPABASE_SERVICE_ROLE_KEY) and new (SUPABASE_SECRET_KEY) naming
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!process.env.SUPABASE_URL || !supabaseSecretKey) {
    return res.status(500).json({ 
      error: 'Server configuration error: Database credentials are missing' 
    });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    supabaseSecretKey
  );

  try {
    const { conversationId, rating, comment } = req.body;

    if (!conversationId || !rating) {
      return res.status(400).json({ error: 'conversationId and rating are required' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    // Update conversation with feedback
    const { error } = await supabase
      .from('chatbot_conversations')
      .update({
        feedback_rating: rating,
        feedback_comment: comment || null,
        feedback_provided_at: new Date().toISOString()
      })
      .eq('conversation_id', conversationId);

    if (error) {
      console.error('Error saving feedback:', error);
      return res.status(500).json({ error: 'Failed to save feedback' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Feedback API error:', error);
    return res.status(500).json({ error: 'An error occurred processing your feedback' });
  }
};

