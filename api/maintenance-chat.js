import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { getGlobalAdminPhones } from './voice/vapi-config.js';

// Model selection - change this to test different models
// Options: 'gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo', 'gpt-4o', 'gpt-4o-mini'
const CHAT_MODEL = process.env.CHAT_MODEL || 'gpt-4o';

// Check if DEBUG_MODE is active
function isDebugMode() {
  const debugMode = process.env.DEBUG_MODE;
  if (!debugMode) return false;
  const normalized = debugMode.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on';
}

// Helper function to add debug info to responses
function addDebugInfo(response) {
  if (isDebugMode()) {
    return { ...response, debugModel: CHAT_MODEL };
  }
  return response;
}

export default async function handler(req, res) {
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

  // Check for required environment variables
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set');
    return res.status(500).json({ error: 'Server configuration error: OpenAI API key is missing' });
  }

  // Support both old (SUPABASE_SERVICE_ROLE_KEY) and new (SUPABASE_SECRET_KEY) naming
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!process.env.SUPABASE_URL || !supabaseSecretKey) {
    console.error('Supabase credentials are not set', {
      hasUrl: !!process.env.SUPABASE_URL,
      hasSecretKey: !!supabaseSecretKey,
      hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
    });
    return res.status(500).json({ 
      error: 'Server configuration error: Database credentials are missing. Please set SUPABASE_SECRET_KEY (new API Keys) or SUPABASE_SERVICE_ROLE_KEY (legacy) in Vercel environment variables.' 
    });
  }

  // Initialize clients after verifying environment variables
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    supabaseSecretKey
  );

  try {
    // Validate request body exists
    if (!req.body) {
      return res.status(400).json({ error: 'Request body is required' });
    }

    const { messages, userId, unitId, email, conversationId } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Get or create conversation
    let currentConversationId = conversationId;
    if (!currentConversationId) {
      // Check if there's an existing active conversation for this user/unit that hasn't been ended
      // Only reuse if it's recent (within last hour) and hasn't created a maintenance request
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: existingConversation } = await supabase
        .from('chatbot_conversations')
        .select('conversation_id, transcript, maintenance_request_id, ended_at')
        .eq('user_id', userId)
        .is('ended_at', null) // Not ended
        .is('maintenance_request_id', null) // No maintenance request created yet
        .gte('created_at', oneHourAgo) // Recent (within last hour)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (existingConversation) {
        // Reuse existing conversation
        currentConversationId = existingConversation.conversation_id;
        console.log('[Chat] Reusing existing conversation:', currentConversationId);
        
        // Update the existing conversation's transcript with current messages
        await supabase
          .from('chatbot_conversations')
          .update({ transcript: JSON.stringify(messages) })
          .eq('conversation_id', currentConversationId);
      } else {
        // Create new conversation only if no active one exists
        const { data: newConversation, error: convError } = await supabase
          .from('chatbot_conversations')
          .insert([{
            user_id: userId,
            unit_id: null, // Will be set after we get unitId
            transcript: JSON.stringify(messages)
          }])
          .select('conversation_id')
          .single();
        
        if (convError) {
          console.error('Error creating conversation:', convError);
        } else {
          currentConversationId = newConversation?.conversation_id;
          console.log('[Chat] Created new conversation:', currentConversationId);
        }
      }
    } else {
      // Verify the conversation exists and belongs to this user
      const { data: existingConv } = await supabase
        .from('chatbot_conversations')
        .select('conversation_id, user_id')
        .eq('conversation_id', currentConversationId)
        .eq('user_id', userId)
        .maybeSingle();
      
      if (!existingConv) {
        console.warn('[Chat] Conversation ID provided but not found or doesn\'t belong to user. Creating new conversation.');
        // Create new conversation if the provided one doesn't exist
        const { data: newConversation, error: convError } = await supabase
          .from('chatbot_conversations')
          .insert([{
            user_id: userId,
            unit_id: null,
            transcript: JSON.stringify(messages)
          }])
          .select('conversation_id')
          .single();
        
        if (convError) {
          console.error('Error creating conversation:', convError);
        } else {
          currentConversationId = newConversation?.conversation_id;
        }
      }
    }

    // Get user's active unit if unitId not provided
    let finalUnitId = unitId;
    if (!finalUnitId) {
      const { data: activeLease, error: leaseError } = await supabase
        .from('lease_clients')
        .select('leases!inner(unit_id, status)')
        .eq('user_id', userId)
        .eq('leases.status', 'active')
        .limit(1)
        .single();

      if (leaseError) {
        console.error('Error fetching active lease:', leaseError);
      }

      if (activeLease?.leases) {
        finalUnitId = activeLease.leases.unit_id;
      }
    }

    if (!finalUnitId) {
      return res.status(400).json({ error: 'No active unit found for this tenant' });
    }

    // Update conversation with unit_id and transcript if we have a conversation
    if (currentConversationId) {
      const updateData = {};
      if (finalUnitId) {
        updateData.unit_id = finalUnitId;
      }
      // Always update transcript to include current messages
      updateData.transcript = JSON.stringify(messages);
      
      await supabase
        .from('chatbot_conversations')
        .update(updateData)
        .eq('conversation_id', currentConversationId);
    }

    // Get unit and property information
    const { data: unitData, error: unitError } = await supabase
      .from('units')
      .select(`
        unit_id,
        unit_number,
        property_id,
        properties!inner(
          property_id,
          property_type
        )
      `)
      .eq('unit_id', finalUnitId)
      .single();

    if (unitError) {
      console.error('Error fetching unit:', unitError);
      return res.status(400).json({ error: `Unit not found: ${unitError.message || 'Database error'}` });
    }

    if (!unitData) {
      return res.status(400).json({ error: 'Unit not found' });
    }

    const propertyId = unitData.properties.property_id;
    const unitNumber = unitData.unit_number;

    // Define functions for the AI to call
    const functions = [
      {
        name: 'assess_urgency',
        description: 'Assess the urgency level of a maintenance issue. Returns the urgency level and recommended action.',
        parameters: {
          type: 'object',
          properties: {
            issue_description: {
              type: 'string',
              description: 'The maintenance issue described by the tenant'
            },
            urgency_level: {
              type: 'string',
              enum: ['life_threatening', 'emergency', 'urgent', 'routine'],
              description: 'The assessed urgency level'
            },
            reasoning: {
              type: 'string',
              description: 'Brief explanation of why this urgency level was chosen'
            }
          },
          required: ['issue_description', 'urgency_level', 'reasoning']
        }
      },
      {
        name: 'find_emergency_vendors',
        description: 'Find vendors approved for emergency service that match the maintenance issue keywords. Only use this for emergency or urgent situations.',
        parameters: {
          type: 'object',
          properties: {
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: 'Keywords describing the maintenance issue (e.g., ["plumbing", "leak", "water"])'
            }
          },
          required: ['keywords']
        }
      },
      {
        name: 'find_routine_vendors',
        description: 'INTERNAL FUNCTION - Do NOT call this directly. Vendors are automatically found and assigned when creating a maintenance request. This function is only used internally by the system.',
        parameters: {
          type: 'object',
          properties: {
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: 'Keywords describing the maintenance issue'
            }
          },
          required: ['keywords']
        }
      },
      {
        name: 'create_maintenance_request',
        description: 'Create a maintenance request in the system.',
        parameters: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'Detailed description of the maintenance issue'
            },
            priority: {
              type: 'string',
              enum: ['Low', 'Medium', 'High', 'Urgent'],
              description: 'Priority level based on urgency assessment'
            },
            status: {
              type: 'string',
              enum: ['New', 'In Progress', 'On Hold', 'Completed'],
              description: 'Initial status (usually "New")'
            }
          },
          required: ['description', 'priority', 'status']
        }
      },
      {
        name: 'get_contact_information',
        description: 'Get contact information (phone number and name) for the property manager or landlord. Use this when the tenant asks for contact information, phone numbers, or how to reach their property manager or landlord.',
        parameters: {
          type: 'object',
          properties: {
            contact_type: {
              type: 'string',
              enum: ['property_manager', 'landlord', 'any'],
              description: 'Type of contact to retrieve. "property_manager" for manager only, "landlord" for property owner only, "any" for either (prefers manager)'
            }
          },
          required: ['contact_type']
        }
      },
      {
        name: 'reschedule_appointment',
        description: 'Reschedule a repair appointment. Use this when the tenant wants to change the time of an existing scheduled appointment.',
        parameters: {
          type: 'object',
          properties: {
            appointment_id: {
              type: 'number',
              description: 'The ID of the appointment to reschedule'
            },
            reason: {
              type: 'string',
              description: 'Optional reason for rescheduling'
            }
          },
          required: ['appointment_id']
        }
      }
    ];

    // Count user messages to ensure we have enough conversation before creating requests
    const userMessageCount = messages.filter(m => m.role === 'user').length;
    // Require at least 2-3 user messages with actual content (not just "hi" or "hello")
    const substantiveUserMessages = messages
      .filter(m => m.role === 'user')
      .filter(m => {
        const content = (m.content || '').toLowerCase().trim();
        return content.length > 10 && !['hi', 'hello', 'hey'].includes(content);
      }).length;
    const hasEnoughConversation = substantiveUserMessages >= 2; // Require at least 2 substantive user messages
    
    // Check if we have enough information by looking at message length and content
    // Don't require the LAST message to be long - check if we have enough substantive messages overall
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
    const hasDetailedInfo = substantiveUserMessages >= 2; // If we have 2+ substantive messages, we have enough info
    const reallyHasEnoughConversation = hasEnoughConversation && hasDetailedInfo;

    // Check if we've asked about scheduling preferences
    const lastAssistantMessage = messages.filter(m => m.role === 'assistant').pop()?.content || '';
    const wasAskingScheduling = lastAssistantMessage.includes('dates and times') || 
                                lastAssistantMessage.includes('scheduling preferences') ||
                                lastAssistantMessage.includes('prefer or must avoid');
    
    // Check if user responded after we asked about scheduling
    // Don't parse keywords - just check if they responded
    let hasSchedulingInfo = false;
    const schedulingAskedMessages = messages.filter((m, idx) => {
      if (m.role === 'assistant') {
        const content = m.content || '';
        return content.includes('dates and times') || 
               content.includes('scheduling preferences') ||
               content.includes('prefer or must avoid') ||
               (content.includes('scheduling') && (content.includes('prefer') || content.includes('available') || content.includes('appointment')));
      }
      return false;
    });
    
    if (schedulingAskedMessages.length > 0) {
      // Find the index of the most recent scheduling question
      const lastSchedulingAskIndex = messages.findIndex(m => 
        m.role === 'assistant' && 
        (m.content?.includes('dates and times') || 
         m.content?.includes('scheduling preferences') ||
         m.content?.includes('prefer or must avoid') ||
         (m.content?.includes('scheduling') && (m.content?.includes('prefer') || m.content?.includes('available') || m.content?.includes('appointment'))))
      );
      
      // Check if there's a user message after we asked
      if (lastSchedulingAskIndex >= 0) {
        const userMessagesAfterAsk = messages
          .slice(lastSchedulingAskIndex + 1)
          .filter(m => m.role === 'user')
          .map(m => m.content?.trim())
          .filter(content => content && content.length > 0);
        
        hasSchedulingInfo = userMessagesAfterAsk.length > 0;
      }
    }

    // Check conversation state to determine which functions should be available
    const urgencyAssessed = messages.some(m => 
      m.role === 'assistant' && 
      (m.content?.includes('assessed this as') || m.content?.includes('priority'))
    );
    
    const schedulingAsked = messages.some(m => 
      m.role === 'assistant' && (
        m.content?.includes('dates and times') || 
        m.content?.includes('scheduling preferences') ||
        m.content?.includes('prefer or must avoid') ||
        m.content?.includes('availability') && (m.content?.includes('maintenance') || m.content?.includes('repair') || m.content?.includes('visit')) ||
        (m.content?.includes('scheduling') && (m.content?.includes('prefer') || m.content?.includes('available') || m.content?.includes('appointment')))
      )
    );
    
    // Check if user responded after we asked about scheduling (no keyword parsing)
    let hasSchedulingResponse = false;
    if (schedulingAsked) {
      // Find when we last asked about scheduling
      let lastSchedulingAskIndex = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          const content = messages[i].content || '';
          if (content.includes('dates and times') || 
              content.includes('scheduling preferences') ||
              content.includes('prefer or must avoid') ||
              (content.includes('availability') && (content.includes('maintenance') || content.includes('repair') || content.includes('visit'))) ||
              (content.includes('scheduling') && (content.includes('prefer') || content.includes('available') || content.includes('appointment')))) {
            lastSchedulingAskIndex = i;
            break;
          }
        }
      }
      
      // Check if there's a user message after we asked
      if (lastSchedulingAskIndex >= 0) {
        const userMessagesAfterAsk = messages
          .slice(lastSchedulingAskIndex + 1)
          .filter(m => m.role === 'user')
          .map(m => m.content?.trim())
          .filter(content => content && content.length > 0);
        
        hasSchedulingResponse = userMessagesAfterAsk.length > 0;
      }
    }

    // Simplify: Let the model decide when to call functions based on the prompt
    // The prompt guides the workflow, so we don't need strict control
    let functionCallParam = 'auto'; // Let model choose based on conversation flow
    
    // Only restrict if we clearly don't have enough conversation yet
    if (!reallyHasEnoughConversation) {
      functionCallParam = 'none'; // Force questions first
    }

    // Debug: Log available functions
    if (isDebugMode()) {
      const availableFunctions = functions.filter(f => f.name !== 'find_routine_vendors').map(f => f.name);
      console.log('[DEBUG] Available functions to model:', availableFunctions);
      console.log('[DEBUG] create_maintenance_request included:', availableFunctions.includes('create_maintenance_request'));
      console.log('[DEBUG] function_call parameter:', JSON.stringify(functionCallParam));
      console.log('[DEBUG] Conversation state:', { urgencyAssessed, schedulingAsked, hasSchedulingResponse, reallyHasEnoughConversation });
    }

    // Call OpenAI with function calling
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are Kate, a maintenance assistant for a property management company.

WORKFLOW:
1. Ask questions to understand the maintenance issue (location, severity, duration, safety concerns)
2. Assess urgency and determine priority (Urgent for emergencies, Medium/Low for routine)
3. Ask: "Do you have any dates and times you prefer or must avoid for scheduling the repair?"
4. When you receive scheduling preferences, immediately call the create_maintenance_request function

CRITICAL ACTIONS:
- For life-threatening emergencies (fire, gas leak, medical emergency), immediately tell them to call 911 first
- You determine the priority based on the issue - never ask the user
- When ready to create the request, call create_maintenance_request function - do not announce it first, just call it
- After getting scheduling preferences, call create_maintenance_request immediately without asking for confirmation

OTHER FUNCTIONS:
- Use get_contact_information for phone numbers
- Use list_appointments to show scheduled repairs
- Use reschedule_appointment to change appointment times

Context: Unit ${unitNumber}, Tenant: ${email}`
        },
        ...messages
      ],
      functions: functions.filter(f => f.name !== 'find_routine_vendors'), // Remove find_routine_vendors - vendors are auto-assigned during request creation
      function_call: functionCallParam,
      temperature: 0.7
    });

    const message = completion.choices[0].message;
    let requestCreated = false;

    // If we don't have enough conversation and the AI didn't call a function, it should be asking questions
    // But if it's trying to call assess_urgency without enough info, force it to ask questions first
    if (message.function_call && message.function_call.name === 'assess_urgency' && !reallyHasEnoughConversation) {
      // Force the AI to ask questions first instead of assessing urgency
      const questionResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          ...messages,
          {
            role: 'system',
            content: `STOP - You tried to assess urgency, but you haven't gathered enough information yet. Ask sufficient clarifying questions to understand the issue fully before assessing urgency. Gather information about location, severity, duration, impact, and safety concerns.`
          }
        ],
        functions: functions.filter(f => f.name !== 'find_routine_vendors' && f.name !== 'assess_urgency'),
        function_call: 'none',
        temperature: 0.7,
        max_tokens: 300
      });
      
      // Update conversation transcript
      if (currentConversationId) {
        const updatedMessages = [
          ...messages,
          {
            role: 'assistant',
            content: questionResponse.choices[0].message.content
          }
        ];
        await supabase
          .from('chatbot_conversations')
          .update({ transcript: JSON.stringify(updatedMessages) })
          .eq('conversation_id', currentConversationId);
      }
      
      return res.json(addDebugInfo({
        message: questionResponse.choices[0].message.content,
        requestCreated: false,
        conversationId: currentConversationId
      }));
    }

    // Handle function calls
    if (message.function_call) {
      const functionName = message.function_call.name;
      const functionArgs = JSON.parse(message.function_call.arguments);

      if (functionName === 'assess_urgency') {
        return handleAssessUrgency(functionArgs, messages, res, functions, finalUnitId, userId, propertyId, supabase, openai, 0, userMessageCount, currentConversationId);
      } else if (functionName === 'find_emergency_vendors') {
        return handleFindEmergencyVendors(functionArgs.keywords, propertyId, messages, res, functions, finalUnitId, userId, supabase, openai, 0, currentConversationId);
      } else if (functionName === 'find_routine_vendors') {
        return handleFindRoutineVendors(functionArgs.keywords, propertyId, messages, res, functions, finalUnitId, userId, supabase, openai, 0, currentConversationId);
      } else if (functionName === 'create_maintenance_request') {
        // Model has decided to create the request - proceed immediately
        // Trust the model's judgment based on the prompt
        return handleCreateMaintenanceRequest(functionArgs, finalUnitId, userId, messages, res, functions, supabase, openai, null, currentConversationId, req);
      } else if (functionName === 'get_contact_information') {
        return handleGetContactInformation(functionArgs, propertyId, res, supabase);
      } else if (functionName === 'list_appointments') {
        return handleListAppointments(userId, functionArgs, res, supabase, currentConversationId);
      } else if (functionName === 'reschedule_appointment') {
        return handleRescheduleAppointment(functionArgs, userId, res, supabase, openai, messages, functions, finalUnitId, propertyId, currentConversationId);
      }
    }

    // No function call - just return the message
    // Trust the model to call functions when appropriate based on the prompt
    const responseMessage = message.content || 'I understand. Can you tell me more about the issue?';
    
    // Update conversation transcript
    if (currentConversationId) {
      const updatedMessages = [...messages, { role: 'assistant', content: responseMessage }];
      await supabase
        .from('chatbot_conversations')
        .update({ transcript: JSON.stringify(updatedMessages) })
        .eq('conversation_id', currentConversationId);
    }
    
    return res.json(addDebugInfo({
      message: responseMessage,
      requestCreated: false,
      conversationId: currentConversationId
    }));

  } catch (error) {
    console.error('Chat API error:', error);
    console.error('Error stack:', error?.stack);
    // Ensure we always return JSON, even on errors
    const errorMessage = error?.message || 'An error occurred processing your request';
    return res.status(500).json({
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    });
  }
};

async function handleAssessUrgency(functionArgs, messages, res, functions, unitId, userId, propertyId, supabase, openai, recursionDepth = 0, userMessageCount = 0, conversationId = null) {
  try {
    const urgencyLevel = functionArgs.urgency_level;
    const reasoning = functionArgs.reasoning;

    // Prevent infinite recursion
    if (recursionDepth > 5) {
      return res.status(500).json({ error: 'Maximum processing depth reached. Please try again with a simpler request.' });
    }

    if (urgencyLevel === 'life_threatening') {
      // Return directly without another OpenAI call to save time
      return res.json({
        message: `🚨 **LIFE-THREATENING EMERGENCY DETECTED** 🚨\n\nBased on your description, this appears to be a life-threatening emergency. **Please call 911 immediately.** Do not wait. Your safety is the top priority.\n\nAfter calling 911, please contact your property manager to inform them of the situation.`,
        requestCreated: false
      });
    }

    // Continue conversation based on urgency
    // For urgent issues, we should ask clarifying questions first, not immediately create requests
    const followUp = await openai.chat.completions.create({
      model: CHAT_MODEL, // Use configured model for follow-up calls
      messages: [
        ...messages,
        {
          role: 'assistant',
          content: `I've assessed this as ${urgencyLevel === 'emergency' ? 'an emergency' : urgencyLevel === 'urgent' ? 'an urgent' : 'a routine'} issue.`
        },
        {
          role: 'system',
          content: urgencyLevel === 'urgent' 
            ? `Urgent issue. ${userMessageCount < 2 ? 'Ask 2-3 more questions first (where exactly, how fast, how long, is it spreading?).' : 'Ask about scheduling preferences, then create the request automatically.'}`
            : urgencyLevel === 'emergency'
            ? 'Emergency detected. Ask about scheduling preferences, then create the request automatically.'
            : `Routine issue. ${userMessageCount < 2 ? 'Ask 2-3 questions now (where exactly, how fast, how long, what do you see?).' : userMessageCount < 3 ? 'Ask 1-2 more questions, then ask about scheduling preferences.' : 'Ask about scheduling preferences, then create the request automatically.'}`
        }
      ],
      functions: functions.filter(f => f.name !== 'find_routine_vendors'), // Remove find_routine_vendors from available functions - vendors are auto-assigned
      function_call: urgencyLevel === 'emergency' 
        ? { name: 'find_emergency_vendors' } 
        : urgencyLevel === 'urgent'
        ? 'none' // Force conversation for urgent - no function calls yet
        : 'none', // Force conversation for routine - no function calls until after confirmation
      temperature: 0.7,
      max_tokens: 500 // Limit response length
    });

    const followUpMessage = followUp.choices[0].message;

    if (followUpMessage.function_call) {
      // Prevent calling find_routine_vendors - vendors are auto-assigned
      if (followUpMessage.function_call.name === 'find_routine_vendors') {
        // Force conversation instead - tell AI to proceed to confirmation
        const noVendorCallResponse = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            ...messages,
            {
              role: 'system',
              content: 'You tried to call find_routine_vendors, but vendors are automatically assigned when creating maintenance requests. Do NOT call this function. Instead, proceed to Step 4: ask the tenant for confirmation to create the maintenance request. Vendors will be automatically assigned during request creation.'
            }
          ],
          functions: functions.filter(f => f.name !== 'find_routine_vendors'),
          function_call: 'none',
          temperature: 0.7,
          max_tokens: 300
        });
        
        // Update conversation transcript
        if (conversationId) {
          const updatedMessages = [
            ...messages,
            {
              role: 'assistant',
              content: noVendorCallResponse.choices[0].message.content || 'I\'ll ask about your scheduling preferences, then create the maintenance request.'
            }
          ];
          await supabase
            .from('chatbot_conversations')
            .update({ transcript: JSON.stringify(updatedMessages) })
            .eq('conversation_id', conversationId);
        }
        
        return res.json(addDebugInfo({
          message: noVendorCallResponse.choices[0].message.content || 'I\'ll ask about your scheduling preferences, then create the maintenance request.',
          requestCreated: false,
          conversationId: conversationId
        }));
      }
      
      // Handle the next function call with increased recursion depth
      return handleFunctionCall(followUpMessage, messages, unitId, userId, propertyId, res, functions, supabase, openai, recursionDepth + 1, conversationId);
    }

    // No function call means the AI wants to continue the conversation - return its message
    // Update conversation transcript
    if (conversationId) {
      const updatedMessages = [
        ...messages,
        {
          role: 'assistant',
          content: followUpMessage.content
        }
      ];
      await supabase
        .from('chatbot_conversations')
        .update({ transcript: JSON.stringify(updatedMessages) })
        .eq('conversation_id', conversationId);
    }
    
    return res.json(addDebugInfo({
      message: followUpMessage.content,
      requestCreated: false,
      conversationId: conversationId
    }));
  } catch (error) {
    console.error('Error in handleAssessUrgency:', error);
    return res.status(500).json({ error: 'Error assessing urgency' });
  }
}

async function handleFindEmergencyVendors(keywords, propertyId, messages, res, functions, unitId, userId, supabase, openai, recursionDepth = 0) {
  try {
    // Extract issue description from conversation
    const issueDescription = messages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(' ') || keywords.join(' ');
    
    console.log('[handleFindEmergencyVendors] Starting search:', {
      keywords,
      issueDescription,
      propertyId,
      unitId,
      userId
    });

    // First, find vendors with emergency approvals for this property
    const { data: approvals, error: approvalsError } = await supabase
      .from('vendor_approvals')
      .select('vendor_id, can_emergency_service, approval_level, approved_by_pmc_id, approved_by_landlord_id, approved_by_property_id')
      .eq('can_emergency_service', true)
      .or(`approved_by_property_id.eq.${propertyId},approved_by_landlord_id.not.is.null,approved_by_pmc_id.not.is.null,approval_level.eq.global`);

    if (approvalsError) {
      console.error('[handleFindEmergencyVendors] Error finding vendor approvals:', approvalsError);
    }

    console.log('[handleFindEmergencyVendors] Approvals found:', {
      count: approvals?.length || 0,
      approvals: approvals || []
    });

    const approvedVendorIds = (approvals || []).map(a => a.vendor_id);
    console.log('[handleFindEmergencyVendors] Approved vendor IDs:', approvedVendorIds);
    
    if (approvedVendorIds.length === 0) {
      console.log('[handleFindEmergencyVendors] No approved vendors found for emergency service');
      if (recursionDepth >= 4) {
        return res.json({
          message: 'I couldn\'t find an emergency vendor for this issue. Please contact your property manager directly or call 911 if this is a life-threatening emergency.',
          requestCreated: false
        });
      }

      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          ...messages,
          {
            role: 'function',
            name: 'find_emergency_vendors',
            content: JSON.stringify({ vendors: [], message: 'No emergency vendors found matching the criteria' })
          }
        ],
        functions: functions,
        function_call: 'auto',
        temperature: 0.7,
        max_tokens: 300
      });

      return res.json({
        message: response.choices[0].message.content || 'I couldn\'t find an emergency vendor for this issue. Please contact your property manager directly.',
        requestCreated: false
      });
    }

    // Fetch vendors with keywords
    const { data: vendors, error: vendorsError } = await supabase
      .from('vendors')
      .select(`
        vendor_id,
        company_name,
        description,
        vendor_keywords(
          vendor_service_keywords(
            keyword_name
          )
        )
      `)
      .in('vendor_id', approvedVendorIds);

    if (vendorsError) {
      console.error('[handleFindEmergencyVendors] Error finding vendors:', vendorsError);
    }

    console.log('[handleFindEmergencyVendors] Vendors fetched:', {
      count: vendors?.length || 0,
      vendors: vendors?.map(v => ({
        vendor_id: v.vendor_id,
        company_name: v.company_name,
        vendor_keywords_structure: v.vendor_keywords
      })) || []
    });

    // Filter vendors using AI-based semantic matching
    const matchingVendors = [];
    for (const vendor of vendors || []) {
      // Extract vendor keywords
      const vendorKeywords = (vendor.vendor_keywords || []).flatMap(vk => {
        const serviceKeywords = vk.vendor_service_keywords;
        if (!serviceKeywords) return [];
        
        if (Array.isArray(serviceKeywords)) {
          return serviceKeywords.map(ks => ks.keyword_name?.toLowerCase()).filter(Boolean);
        } else if (serviceKeywords.keyword_name) {
          return [serviceKeywords.keyword_name.toLowerCase()];
        }
        return [];
      });

      // Use AI to determine if vendor can handle this issue
      const matches = await aiMatchVendor(issueDescription, vendorKeywords, vendor.description, openai);

      console.log('[handleFindEmergencyVendors] Vendor AI match check:', {
        vendor_id: vendor.vendor_id,
        company_name: vendor.company_name,
        vendor_keywords: vendorKeywords,
        issueDescription: issueDescription.substring(0, 100),
        matches
      });

      if (matches) {
        matchingVendors.push(vendor);
      }
    }

    console.log('[handleFindEmergencyVendors] Matching vendors:', {
      count: matchingVendors.length,
      vendors: matchingVendors.map(v => ({
        vendor_id: v.vendor_id,
        company_name: v.company_name
      }))
    });

    if (matchingVendors.length === 0) {
      if (recursionDepth >= 4) {
        return res.json({
          message: 'I couldn\'t find an emergency vendor for this issue. Please contact your property manager directly or call 911 if this is a life-threatening emergency.',
          requestCreated: false
        });
      }

      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          ...messages,
          {
            role: 'function',
            name: 'find_emergency_vendors',
            content: JSON.stringify({ vendors: [], message: 'No emergency vendors found matching the criteria' })
          }
        ],
        functions: functions,
        function_call: 'auto',
        temperature: 0.7,
        max_tokens: 300
      });

      return res.json({
        message: response.choices[0].message.content || 'I couldn\'t find an emergency vendor for this issue. Please contact your property manager directly.',
        requestCreated: false
      });
    }

    // Fetch contacts for matching vendors
    const matchingVendorIds = matchingVendors.map(v => v.vendor_id);
    const { data: contacts, error: contactsError } = await supabase
      .from('contacts')
      .select('contact_id, contactable_id, first_name, middle_name, last_name')
      .in('contactable_id', matchingVendorIds)
      .eq('contactable_type', 'vendor');

    if (contactsError) {
      console.error('Error finding contacts:', contactsError);
    }

    // Fetch contact methods
    const contactIds = (contacts || []).map(c => c.contact_id);
    const { data: contactMethods, error: methodsError } = contactIds.length > 0 ? await supabase
      .from('contact_methods')
      .select('contact_id, method_type, value')
      .in('contact_id', contactIds) : { data: [], error: null };

    if (methodsError) {
      console.error('Error finding contact methods:', methodsError);
    }

    // Format vendor information
    const vendorInfo = matchingVendors.map(v => {
      const contact = (contacts || []).find(c => c.contactable_id === v.vendor_id);
      const contactName = contact ? [contact.first_name, contact.middle_name, contact.last_name]
        .filter(Boolean).join(' ') : null;
      // Prefer company_name, fallback to contact name, then description
      const vendorName = v.company_name || contactName || v.description || 'Unnamed Vendor';
      
      const vendorContactMethods = (contactMethods || []).filter(cm => 
        contact && cm.contact_id === contact.contact_id
      );
      const phone = vendorContactMethods.find(cm => cm.method_type === 'phone')?.value;
      const website = vendorContactMethods.find(cm => cm.method_type === 'website' || cm.method_type === 'url')?.value;
      const email = vendorContactMethods.find(cm => cm.method_type === 'email')?.value;
      
      return {
        name: vendorName,
        phone: phone || null,
        website: website || null,
        email: email || null,
        description: v.description
      };
    });

    // If recursion is deep, skip OpenAI call and create request directly
    if (recursionDepth >= 4) {
      // Format vendor contact info
      const vendorContactInfo = vendorInfo.map(v => {
        const parts = [`**${v.name}**`];
        if (v.phone) {
          parts.push(`📞 Phone: ${v.phone}`);
        }
        if (v.website) {
          parts.push(`🌐 Website: ${v.website}`);
        }
        if (v.email) {
          parts.push(`📧 Email: ${v.email}`);
        }
        if (parts.length === 1) {
          parts.push('(Contact information not available)');
        }
        return parts.join('\n');
      }).join('\n\n');

      // Create maintenance request
      let maintenanceRequestCreated = false;
      try {
        const { data: request, error: requestError } = await supabase
          .from('maintenance_requests')
          .insert([{
            unit_id: unitId,
            tenant_user_id: userId,
            description: issueDescription,
            priority: 'Urgent',
            status: 'New'
          }])
          .select()
          .single();

        if (!requestError && request) {
          maintenanceRequestCreated = true;
          console.log('[handleFindEmergencyVendors] Maintenance request created:', request.request_id);
        }
      } catch (error) {
        console.error('[handleFindEmergencyVendors] Exception creating maintenance request:', error);
      }

      // Update conversation transcript
      if (conversationId) {
        const updatedMessages = [
          ...messages,
          {
            role: 'function',
            name: 'find_emergency_vendors',
            content: JSON.stringify({ vendors: vendorInfo, count: matchingVendors.length })
          },
          {
            role: 'assistant',
            content: `I found ${matchingVendors.length} emergency vendor(s) approved for emergency service:\n\n${vendorContactInfo}\n\nPlease call them directly.${maintenanceRequestCreated ? '\n\n✅ A maintenance request has been created to track this issue.' : ''}`
          }
        ];
        await supabase
          .from('chatbot_conversations')
          .update({ transcript: JSON.stringify(updatedMessages) })
          .eq('conversation_id', conversationId);
      }
      
      return res.json({
        message: `I found ${matchingVendors.length} emergency vendor(s) approved for emergency service:\n\n${vendorContactInfo}\n\nPlease call them directly.${maintenanceRequestCreated ? '\n\n✅ A maintenance request has been created to track this issue.' : ''}`,
        requestCreated: maintenanceRequestCreated,
        conversationId: conversationId
      });
    }

    // Format vendor contact info with all available details
    const vendorContactInfo = vendorInfo.map(v => {
      const parts = [`**${v.name}**`];
      if (v.phone) {
        parts.push(`📞 Phone: ${v.phone}`);
      }
      if (v.website) {
        parts.push(`🌐 Website: ${v.website}`);
      }
      if (v.email) {
        parts.push(`📧 Email: ${v.email}`);
      }
      if (parts.length === 1) {
        parts.push('(Contact information not available)');
      }
      return parts.join('\n');
    }).join('\n\n');

    // Automatically create a maintenance request for emergency issues
    let maintenanceRequestCreated = false;
    try {
      const { data: request, error: requestError } = await supabase
        .from('maintenance_requests')
        .insert([{
          unit_id: unitId,
          tenant_user_id: userId,
          description: issueDescription,
          priority: 'Urgent',
          status: 'New'
        }])
        .select()
        .single();

      if (!requestError && request) {
        maintenanceRequestCreated = true;
        console.log('[handleFindEmergencyVendors] Maintenance request created:', request.request_id);
      } else {
        console.error('[handleFindEmergencyVendors] Error creating maintenance request:', requestError);
      }
    } catch (error) {
      console.error('[handleFindEmergencyVendors] Exception creating maintenance request:', error);
    }

    // Generate AI response about the vendors
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        ...messages,
        {
          role: 'function',
          name: 'find_emergency_vendors',
          content: JSON.stringify({ 
            vendors: vendorInfo,
            vendor_count: matchingVendors.length,
            maintenance_request_created: maintenanceRequestCreated
          })
        }
      ],
      temperature: 0.7,
      max_tokens: 300
    });

    const responseMessage = response.choices[0].message;
    const aiMessage = responseMessage.content || '';

    // Combine AI message with vendor contact info
    const fullMessage = aiMessage + (vendorContactInfo ? `\n\n**Emergency Vendor Contact Information:**\n\n${vendorContactInfo}` : '') +
      (maintenanceRequestCreated ? '\n\n✅ A maintenance request has been created to track this issue.' : '');

    return res.json({
      message: fullMessage,
      requestCreated: maintenanceRequestCreated
    });

  } catch (error) {
    console.error('Error in handleFindEmergencyVendors:', error);
    return res.status(500).json({ error: 'Error finding emergency vendors' });
  }
}

// Use AI to intelligently match maintenance issues to vendor capabilities
async function aiMatchVendor(issueDescription, vendorKeywords, vendorDescription, openai) {
  try {
    const vendorCapabilities = [
      ...(vendorKeywords || []),
      vendorDescription || ''
    ].filter(Boolean).join(', ');

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a maintenance request matching assistant. Determine if a vendor can handle a maintenance issue based on their capabilities. Return only "yes" or "no".'
        },
        {
          role: 'user',
          content: `Maintenance issue: "${issueDescription}"

Vendor capabilities: "${vendorCapabilities}"

Can this vendor handle this issue? Answer only "yes" or "no".`
        }
      ],
      temperature: 0.1,
      max_tokens: 10
    });

    const answer = response.choices[0].message.content?.toLowerCase().trim();
    return answer === 'yes';
  } catch (error) {
    console.error('[aiMatchVendor] Error:', error);
    // Fallback to keyword matching if AI fails
    return false;
  }
}

async function handleFindRoutineVendors(keywords, propertyId, messages, res, functions, unitId, userId, supabase, openai, recursionDepth = 0, conversationId = null) {
  try {
    // Extract issue description from conversation
    const issueDescription = messages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(' ') || keywords.join(' ');
    
    console.log('[handleFindRoutineVendors] Starting search:', {
      keywords,
      issueDescription,
      propertyId,
      unitId,
      userId
    });

    // First, get the property's landlord_id and pmc_id to filter vendor approvals properly
    let propertyLandlordId = null;
    let propertyPmcId = null;
    if (propertyId) {
      const { data: propertyData } = await supabase
        .from('properties')
        .select('landlord_id, pmc_id')
        .eq('property_id', propertyId)
        .maybeSingle();
      
      propertyLandlordId = propertyData?.landlord_id;
      propertyPmcId = propertyData?.pmc_id;
    }

    // Find vendors with approvals for this SPECIFIC property
    // Priority: 1) Property-specific, 2) Property's landlord, 3) Property's PMC, 4) Global
    const conditions = [];
    if (propertyId) {
      conditions.push(`approved_by_property_id.eq.${propertyId}`);
    }
    if (propertyLandlordId) {
      conditions.push(`approved_by_landlord_id.eq.${propertyLandlordId}`);
    }
    if (propertyPmcId) {
      conditions.push(`approved_by_pmc_id.eq.${propertyPmcId}`);
    }
    if (propertyId) {
      conditions.push(`approval_level.eq.global`);
    }
    
    if (conditions.length === 0) {
      // No property context - return empty
      return res.json({
        message: 'I couldn\'t find approved vendors for this property. I\'ll create a maintenance request for the property manager to review.',
        requestCreated: false,
        conversationId: conversationId
      });
    }
    
    const { data: approvals, error: approvalsError } = await supabase
      .from('vendor_approvals')
      .select('vendor_id, approval_level, approved_by_pmc_id, approved_by_landlord_id, approved_by_property_id')
      .or(conditions.join(','));

    if (approvalsError) {
      console.error('[handleFindRoutineVendors] Error finding vendor approvals:', approvalsError);
    }

    console.log('[handleFindRoutineVendors] Approvals found:', {
      count: approvals?.length || 0,
      approvals: approvals || [],
      propertyId,
      propertyLandlordId,
      propertyPmcId
    });

    const approvedVendorIds = (approvals || []).map(a => a.vendor_id);
    console.log('[handleFindRoutineVendors] Approved vendor IDs:', approvedVendorIds);
    
    if (approvedVendorIds.length === 0) {
      console.log('[handleFindRoutineVendors] No approved vendors found');
      if (recursionDepth >= 4) {
        // Update conversation transcript
        if (conversationId) {
          const updatedMessages = [
            ...messages,
            {
              role: 'function',
              name: 'find_routine_vendors',
              content: JSON.stringify({ vendors: [], message: 'No vendors found' })
            },
            {
              role: 'assistant',
              content: 'I couldn\'t find a vendor for this issue. I\'ll create a maintenance request for the property manager to review.'
            }
          ];
          await supabase
            .from('chatbot_conversations')
            .update({ transcript: JSON.stringify(updatedMessages) })
            .eq('conversation_id', conversationId);
        }
        
        return res.json({
          message: 'I couldn\'t find a vendor for this issue. I\'ll create a maintenance request for the property manager to review.',
          requestCreated: false,
          conversationId: conversationId
        });
      }

      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          ...messages,
          {
            role: 'function',
            name: 'find_routine_vendors',
            content: JSON.stringify({ vendors: [], message: 'No vendors found' })
          }
        ],
        functions: functions,
        function_call: 'auto',
        temperature: 0.7,
        max_tokens: 300
      });

      const responseMessage = response.choices[0].message.content || 'I couldn\'t find a vendor for this issue. I\'ll create a maintenance request for the property manager to review.';
      
      // Update conversation transcript
      if (conversationId) {
        const updatedMessages = [
          ...messages,
          {
            role: 'function',
            name: 'find_routine_vendors',
            content: JSON.stringify({ vendors: [], message: 'No vendors found' })
          },
          {
            role: 'assistant',
            content: responseMessage
          }
        ];
        await supabase
          .from('chatbot_conversations')
          .update({ transcript: JSON.stringify(updatedMessages) })
          .eq('conversation_id', conversationId);
      }

      return res.json({
        message: responseMessage,
        requestCreated: false,
        conversationId: conversationId
      });
    }

    // Fetch vendors with keywords
    const { data: vendors, error: vendorsError } = await supabase
      .from('vendors')
      .select(`
        vendor_id,
        company_name,
        description,
        vendor_keywords(
          vendor_service_keywords(
            keyword_name
          )
        )
      `)
      .in('vendor_id', approvedVendorIds)
      .limit(10);

    if (vendorsError) {
      console.error('[handleFindRoutineVendors] Error finding vendors:', vendorsError);
    }

    console.log('[handleFindRoutineVendors] Vendors fetched:', {
      count: vendors?.length || 0,
      vendors: vendors?.map(v => ({
        vendor_id: v.vendor_id,
        company_name: v.company_name,
        vendor_keywords_structure: v.vendor_keywords
      })) || []
    });

    // Filter vendors using AI-based semantic matching
    const matchingVendors = [];
    for (const vendor of vendors || []) {
      // Extract vendor keywords
      const vendorKeywords = (vendor.vendor_keywords || []).flatMap(vk => {
        const serviceKeywords = vk.vendor_service_keywords;
        if (!serviceKeywords) return [];
        
        if (Array.isArray(serviceKeywords)) {
          return serviceKeywords.map(ks => ks.keyword_name?.toLowerCase()).filter(Boolean);
        } else if (serviceKeywords.keyword_name) {
          return [serviceKeywords.keyword_name.toLowerCase()];
        }
        return [];
      });

      // Use AI to determine if vendor can handle this issue
      const matches = await aiMatchVendor(issueDescription, vendorKeywords, vendor.description, openai);

      console.log('[handleFindRoutineVendors] Vendor AI match check:', {
        vendor_id: vendor.vendor_id,
        company_name: vendor.company_name,
        vendor_keywords: vendorKeywords,
        issueDescription: issueDescription.substring(0, 100),
        matches
      });

      if (matches) {
        matchingVendors.push(vendor);
      }
    }

    console.log('[handleFindRoutineVendors] Matching vendors:', {
      count: matchingVendors.length,
      vendors: matchingVendors.map(v => ({
        vendor_id: v.vendor_id,
        company_name: v.company_name
      }))
    });

    if (matchingVendors.length === 0) {
      // Skip OpenAI call if recursion is too deep
      if (recursionDepth >= 4) {
        // Update conversation transcript
        if (conversationId) {
          const updatedMessages = [
            ...messages,
            {
              role: 'function',
              name: 'find_routine_vendors',
              content: JSON.stringify({ vendors: [], message: 'No vendors found' })
            },
            {
              role: 'assistant',
              content: 'I couldn\'t find a vendor for this issue. I\'ll create a maintenance request for the property manager to review.'
            }
          ];
          await supabase
            .from('chatbot_conversations')
            .update({ transcript: JSON.stringify(updatedMessages) })
            .eq('conversation_id', conversationId);
        }
        
        return res.json({
          message: 'I couldn\'t find a vendor for this issue. I\'ll create a maintenance request for the property manager to review.',
          requestCreated: false,
          conversationId: conversationId
        });
      }

      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo', // Use faster model
        messages: [
          ...messages,
          {
            role: 'function',
            name: 'find_routine_vendors',
            content: JSON.stringify({ vendors: [], message: 'No vendors found' })
          }
        ],
        functions: functions,
        function_call: 'auto',
        temperature: 0.7,
        max_tokens: 300
      });

      const responseMessage = response.choices[0].message.content || 'I couldn\'t find a vendor for this issue. I\'ll create a maintenance request for the property manager to review.';
      
      // Update conversation transcript
      if (conversationId) {
        const updatedMessages = [
          ...messages,
          {
            role: 'function',
            name: 'find_routine_vendors',
            content: JSON.stringify({ vendors: [], message: 'No vendors found' })
          },
          {
            role: 'assistant',
            content: responseMessage
          }
        ];
        await supabase
          .from('chatbot_conversations')
          .update({ transcript: JSON.stringify(updatedMessages) })
          .eq('conversation_id', conversationId);
      }

      return res.json({
        message: responseMessage,
        requestCreated: false,
        conversationId: conversationId
      });
    }

    // If recursion is deep, skip OpenAI call and create request directly
    if (recursionDepth >= 4) {
      return res.json({
        message: `I found ${matchingVendors.length} vendor(s) that can handle this issue. Let me create a maintenance request.`,
        requestCreated: false
      });
    }

    // Return the matching vendors for auto-assignment (don't ask tenant to choose)
    // The vendors will be auto-assigned when create_maintenance_request is called
    const vendorNames = matchingVendors.map(v => v.company_name || 'Unnamed Vendor').join(', ');
    
    // Update conversation transcript
    if (conversationId) {
      const updatedMessages = [
        ...messages,
        {
          role: 'function',
          name: 'find_routine_vendors',
          content: JSON.stringify({ 
            vendors: matchingVendors.map(v => ({
              vendor_id: v.vendor_id,
              company_name: v.company_name
            })),
            message: `Found ${matchingVendors.length} vendor(s) that can handle this issue. These will be considered for auto-assignment.`
          })
        }
      ];
      await supabase
        .from('chatbot_conversations')
        .update({ transcript: JSON.stringify(updatedMessages) })
        .eq('conversation_id', conversationId);
    }
    
    // Return message indicating vendors were found and will be auto-assigned
    // Don't ask tenant to choose - just proceed to confirmation
    return res.json({
      message: `I've identified ${matchingVendors.length} vendor(s) that can handle this issue. They will be automatically assigned when I create the maintenance request. Do you have any dates and times you prefer or must avoid for scheduling the repair?`,
      requestCreated: false,
      conversationId: conversationId,
      vendors: matchingVendors.map(v => ({
        vendor_id: v.vendor_id,
        company_name: v.company_name
      })) // Pass vendors for auto-assignment
    });

  } catch (error) {
    console.error('Error in handleFindRoutineVendors:', error);
    return res.status(500).json({ error: 'Error finding vendors' });
  }
}

async function handleCreateMaintenanceRequest(functionArgs, unitId, userId, messages, res, functions, supabase, openai, originalRequest, conversationId, req = null) {
  try {
    const finalUnitId = unitId;
    const finalUserId = userId;

    if (!finalUnitId || !finalUserId) {
      return res.status(400).json({ error: 'Missing unit or user information' });
    }

    // Get tenant name from contact
    let tenantName = null;
    let tenantPhone = null; // Declare at function scope for DEBUG_MODE
    try {
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', finalUserId)
        .maybeSingle();
      
      if (clientError) {
        console.error('[handleCreateMaintenanceRequest] Error fetching client:', clientError);
      }
      
      // Try both 'client' and 'tenant' contactable types
      // First try 'client' type (contactable_id = user_id)
      let contact = null;
      let contactId = null;
      const { data: contactClient, error: contactClientError } = await supabase
        .from('contacts')
        .select('contact_id, first_name, middle_name, last_name')
        .eq('contactable_id', finalUserId)
        .eq('contactable_type', 'client')
        .maybeSingle();
      
      if (contactClientError) {
        console.error('[handleCreateMaintenanceRequest] Error fetching contact (client type):', contactClientError);
      }
      
      if (contactClient) {
        contact = contactClient;
        contactId = contactClient.contact_id;
      } else if (client?.client_id) {
        // Fallback: try 'tenant' type (contactable_id = client_id)
        const { data: contactTenant, error: contactTenantError } = await supabase
          .from('contacts')
          .select('contact_id, first_name, middle_name, last_name')
          .eq('contactable_id', client.client_id)
          .eq('contactable_type', 'tenant')
          .maybeSingle();
        
        if (contactTenantError) {
          console.error('[handleCreateMaintenanceRequest] Error fetching contact (tenant type):', contactTenantError);
        }
        
        if (contactTenant) {
          contact = contactTenant;
          contactId = contactTenant.contact_id;
        }
      }
      
      if (contact) {
        const nameParts = [
          contact.first_name,
          contact.middle_name,
          contact.last_name
        ].filter(Boolean);
        tenantName = nameParts.join(' ').trim();
        console.log('[handleCreateMaintenanceRequest] Tenant name found:', tenantName);
      } else {
        console.log('[handleCreateMaintenanceRequest] No contact found for user_id:', finalUserId, 'client_id:', client?.client_id);
      }
      
      // Get tenant phone number for DEBUG_MODE
      if (contactId && isDebugMode()) {
        try {
          const { data: phoneMethods } = await supabase
            .from('contact_methods')
            .select('value, method_type')
            .eq('contact_id', contactId)
            .in('method_type', ['Phone', 'phone', 'Cell', 'cell', 'Mobile', 'mobile'])
            .limit(1)
            .maybeSingle();
          
          if (phoneMethods) {
            tenantPhone = phoneMethods.value;
            console.log('[handleCreateMaintenanceRequest] [DEBUG_MODE] Tenant phone found:', tenantPhone);
          } else {
            console.log('[handleCreateMaintenanceRequest] [DEBUG_MODE] No phone number found for tenant');
          }
        } catch (err) {
          console.error('[handleCreateMaintenanceRequest] [DEBUG_MODE] Error fetching tenant phone:', err);
        }
      }
      
      if (!client?.client_id) {
        console.log('[handleCreateMaintenanceRequest] No client found for user_id:', finalUserId);
      }
    } catch (err) {
      console.error('[handleCreateMaintenanceRequest] Error fetching tenant name:', err);
      // Continue without tenant name
    }

    // Get property ID for vendor assignment
    let propertyId = null;
    try {
      const { data: unit, error: unitError } = await supabase
        .from('units')
        .select('property_id')
        .eq('unit_id', finalUnitId)
        .single();
      
      if (unitError) {
        console.error('[handleCreateMaintenanceRequest] Error fetching unit:', unitError);
      }
      
      propertyId = unit?.property_id || null;
      console.log('[handleCreateMaintenanceRequest] Property lookup:', { finalUnitId, propertyId, hasUnit: !!unit });
    } catch (err) {
      console.error('[handleCreateMaintenanceRequest] Error fetching property ID:', err);
    }

    // Try to auto-assign a vendor (like voicebot does)
    let assignedVendorId = null;
    let vendorAssignmentNote = null;
    
    if (propertyId && openai) {
      try {
        console.log('[handleCreateMaintenanceRequest] Starting vendor assignment:', { propertyId, hasOpenai: !!openai });
        
        // Extract issue description from conversation
        const issueDescription = messages
          .filter(m => m.role === 'user')
          .map(m => m.content)
          .join(' ') || functionArgs.description;
        
        const priority = functionArgs.priority || 'Medium';
        const isUrgent = priority === 'Urgent' || priority === 'Emergency';
        
        console.log('[handleCreateMaintenanceRequest] Vendor assignment params:', { 
          issueDescription: issueDescription.substring(0, 100), 
          priority, 
          isUrgent,
          propertyId,
          finalUnitId,
          finalUserId
        });
        
        // Import vendor finding function
        const { findEmergencyVendors } = await import('./voice/maintenance-logic.js');
        
        // Extract keywords from description using AI
        const keywordsResponse = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: 'Extract 3-5 keywords from this maintenance issue description that would help match it to a vendor. Return only a JSON array of keywords, nothing else.'
            },
            {
              role: 'user',
              content: issueDescription
            }
          ],
          temperature: 0.3,
          max_tokens: 100
        });
        
        let keywords = [];
        try {
          keywords = JSON.parse(keywordsResponse.choices[0].message.content || '[]');
        } catch {
          // Fallback: extract simple keywords
          keywords = issueDescription.toLowerCase().split(/\s+/).filter(w => w.length > 4).slice(0, 5);
        }
        
        const vendorResult = await findEmergencyVendors(
          keywords,
          propertyId,
          finalUnitId,
          finalUserId,
          supabase,
          openai,
          false, // isVoiceCall
          issueDescription,
          isUrgent // requireEmergencyOnly
        );
        
        if (vendorResult.success && vendorResult.vendors && vendorResult.vendors.length > 0) {
          const selectedVendor = vendorResult.vendors[0];
          assignedVendorId = selectedVendor.vendor_id;
          const vendorName = selectedVendor.name || selectedVendor.company_name || 'Vendor';
          
          const matchedKeywords = selectedVendor.matchedKeywords || [];
          const keywordsText = matchedKeywords.length > 0 
            ? matchedKeywords.slice(0, 5).join(', ')
            : 'service capabilities match';
          
          const issueDesc = issueDescription.substring(0, 80);
          const vendorType = isUrgent ? 'Emergency-approved vendor' : 'Approved vendor';
          vendorAssignmentNote = `Auto-assigned by chatbot: ${vendorName} - ${vendorType}. Selected because the maintenance request (${issueDesc}${issueDescription.length > 80 ? '...' : ''}) matches the vendor's service capabilities (${keywordsText}).`;
          
          if (vendorResult.vendors.length > 1) {
            // Don't mention other vendors - only the chosen one
          }
        } else {
          vendorAssignmentNote = `No vendor auto-assigned. Reason: ${vendorResult.message || 'No approved vendors found matching the issue description.'}`;
        }
      } catch (err) {
        console.error('Error finding vendor for auto-assignment:', err);
        vendorAssignmentNote = `Vendor auto-assignment failed: ${err.message}`;
      }
    } else {
      vendorAssignmentNote = `No vendor auto-assigned. Reason: ${!propertyId ? 'Property ID not available' : 'OpenAI client not available'}.`;
    }

    // Extract scheduling preferences from conversation
    // Simply capture the user's response after we asked about scheduling
    // This works in any language - we just store what they said
    let schedulingPreferences = null;
    
    // Find the most recent assistant message that asked about scheduling
    let schedulingAskIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        const assistantMsg = messages[i].content || '';
        if (assistantMsg.includes('dates and times') || 
            assistantMsg.includes('scheduling preferences') ||
            assistantMsg.includes('prefer or must avoid') ||
            assistantMsg.includes('availability') ||
            assistantMsg.includes('scheduling')) {
          schedulingAskIndex = i;
          break;
        }
      }
    }
    
    // If we asked about scheduling, capture the next user message(s) as their response
    if (schedulingAskIndex >= 0) {
      // Get all user messages after the scheduling question
      const responsesAfterScheduling = messages
        .slice(schedulingAskIndex + 1)
        .filter(m => m.role === 'user')
        .map(m => m.content?.trim())
        .filter(content => content && content.length > 0);
      
      if (responsesAfterScheduling.length > 0) {
        // Join multiple responses if user sent multiple messages
        schedulingPreferences = responsesAfterScheduling.join(' ');
      }
    }
    
    // Build admin notes with tenant name, scheduling preferences, vendor assignment info, and DEBUG_MODE phone
    let adminNotes = '';
    if (tenantName) {
      adminNotes = `Tenant: ${tenantName}\n`;
    }
    if (schedulingPreferences) {
      adminNotes += `Scheduling Preferences: ${schedulingPreferences}\n`;
    }
    if (vendorAssignmentNote) {
      adminNotes += vendorAssignmentNote;
    }
    
    // In DEBUG_MODE, add the tenant's phone number to admin_notes
    // This allows the cron job to call the tenant (who is set up as a Global Admin for testing)
    if (isDebugMode() && tenantPhone) {
      try {
        // Format phone number nicely (add dashes for US numbers)
        // Remove any non-digit characters first
        const digitsOnly = tenantPhone.replace(/\D/g, '');
        let formattedPhone = digitsOnly;
        if (digitsOnly.length === 10) {
          formattedPhone = `${digitsOnly.substring(0, 3)}-${digitsOnly.substring(3, 6)}-${digitsOnly.substring(6)}`;
        } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
          // Remove leading 1 and format
          const tenDigits = digitsOnly.substring(1);
          formattedPhone = `${tenDigits.substring(0, 3)}-${tenDigits.substring(3, 6)}-${tenDigits.substring(6)}`;
        }
        const debugModePhoneNote = `\n[DEBUG_MODE phone: ${formattedPhone}]`;
        adminNotes = (adminNotes ? adminNotes + '\n' : '') + debugModePhoneNote;
        console.log(`[handleCreateMaintenanceRequest] [DEBUG_MODE] Added tenant phone to admin_notes: ${formattedPhone}`);
      } catch (err) {
        console.error(`[handleCreateMaintenanceRequest] [DEBUG_MODE] Error formatting tenant phone:`, err);
      }
    } else if (isDebugMode() && !tenantPhone) {
      console.log(`[handleCreateMaintenanceRequest] [DEBUG_MODE] No tenant phone found - cannot add DEBUG_MODE phone to admin_notes`);
    }

    // Create maintenance request
    const { data: request, error } = await supabase
      .from('maintenance_requests')
      .insert([{
        unit_id: finalUnitId,
        tenant_user_id: finalUserId,
        description: functionArgs.description,
        priority: functionArgs.priority,
        status: functionArgs.status || 'New',
        assigned_vendor_id: assignedVendorId,
        admin_notes: adminNotes || null
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating maintenance request:', error);
      return res.status(500).json({ error: 'Failed to create maintenance request' });
    }

    // Trigger vendor calling via cron endpoint (async, don't wait for response)
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : (req?.headers?.host ? `http://${req.headers.host}` : 'http://localhost:3000');
    
    fetch(`${baseUrl}/api/cron/call-vendors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maintenance_request_id: request.request_id
      })
    }).catch(err => console.error('Error triggering vendor call:', err));

    // Update conversation with maintenance_request_id and final transcript
    if (conversationId) {
      const updatedMessages = [
        ...messages,
        {
          role: 'function',
          name: 'create_maintenance_request',
          content: JSON.stringify({ 
            success: true,
            request_id: request.request_id,
            priority: functionArgs.priority,
            description: functionArgs.description
          })
        }
      ];
      
      // Generate final response with proper closure - use faster model
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo', // Use faster model
        messages: [
          ...updatedMessages,
          {
            role: 'system',
            content: `A maintenance request has been successfully created (Request ID: ${request.request_id}). 

Provide a brief, friendly response (1-2 sentences) that:
1. Confirms the request was created
2. Mentions a vendor will be assigned and will contact them
3. Invites them to ask if they need anything else

Keep it concise and natural. Never mention function calls, protocols, or technical details. DO NOT echo back the full description or priority details - just confirm it was created.`
          }
        ],
        temperature: 0.7,
        max_tokens: 500 // Increased to allow for complete response
      });

      const finalMessage = response.choices[0].message.content || `✅ I've created a maintenance request for you (Request ID: ${request.request_id}, Priority: ${functionArgs.priority}).\n\n**Summary:** ${functionArgs.description}\n\n**What happens next:** A vendor will be assigned to your request and will contact you soon. You can track the status of this request in your maintenance dashboard.\n\nIs there anything else you'd like to report or any questions I can help with?`;
      
      updatedMessages.push({ role: 'assistant', content: finalMessage });
      
      // Update conversation with maintenance_request_id and final transcript
      await supabase
        .from('chatbot_conversations')
        .update({ 
          maintenance_request_id: request.request_id,
          transcript: JSON.stringify(updatedMessages)
        })
        .eq('conversation_id', conversationId);

      return res.json(addDebugInfo({
        message: finalMessage,
        requestCreated: true,
        conversationId: conversationId
      }));
    } else {
      // Fallback if no conversationId (shouldn't happen, but handle gracefully)
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          ...messages,
          {
            role: 'function',
            name: 'create_maintenance_request',
            content: JSON.stringify({ 
              success: true,
              request_id: request.request_id,
              priority: functionArgs.priority,
              description: functionArgs.description,
              message: 'Maintenance request created successfully'
            })
          },
          {
            role: 'system',
            content: `A maintenance request has been successfully created (Request ID: ${request.request_id}). 

Provide a brief, friendly response (1-2 sentences) that:
1. Confirms the request was created
2. Mentions a vendor will be assigned and will contact them
3. Invites them to ask if they need anything else

Keep it concise and natural. Never mention function calls, protocols, or technical details. DO NOT echo back the full description or priority details - just confirm it was created.`
          }
        ],
        temperature: 0.7,
        max_tokens: 400
      });

      // Update conversation transcript even if no conversationId (shouldn't happen, but handle gracefully)
      // Note: conversationId should always exist at this point, but if it doesn't, we can't update
      
      return res.json(addDebugInfo({
        message: response.choices[0].message.content || `✅ I've created a maintenance request for you (Request ID: ${request.request_id}, Priority: ${functionArgs.priority}).\n\n**Summary:** ${functionArgs.description}\n\n**What happens next:** A vendor will be assigned to your request and will contact you soon. You can track the status of this request in your maintenance dashboard.\n\nIs there anything else you'd like to report or any questions I can help with?`,
        requestCreated: true,
        conversationId: null // This shouldn't happen, but return null if no conversationId
      }));
    }

  } catch (error) {
    console.error('Error in handleCreateMaintenanceRequest:', error);
    return res.status(500).json({ error: 'Error creating maintenance request' });
  }
}

async function handleGetContactInformation(functionArgs, propertyId, res, supabase) {
  try {
    if (!propertyId) {
      return res.json({
        message: "I don't have information about your property. Please provide your property address or unit number so I can find the contact information.",
        requestCreated: false
      });
    }

    // Import the function from maintenance-logic
    const { getResponsiblePersonPhone } = await import('./voice/maintenance-logic.js');
    const returnOwnerOnly = functionArgs.contact_type === 'landlord';
    const phoneInfo = await getResponsiblePersonPhone(supabase, propertyId, returnOwnerOnly);

    if (phoneInfo) {
      const contactType = phoneInfo.type === 'property_owner' ? 'property owner' : 
                         phoneInfo.type === 'pm_manager' ? 'property manager' : 
                         phoneInfo.type === 'company_admin' ? 'company administrator' : 
                         'global administrator';
      
      return res.json({
        message: `The ${contactType}'s phone number is ${phoneInfo.phone}. ${phoneInfo.name ? `Their name is ${phoneInfo.name}.` : ''} You can reach them at this number for any questions or concerns.`,
        requestCreated: false,
        conversationId: conversationId
      });
    } else {
      return res.json({
        message: "I couldn't find a contact phone number for the property manager or owner. Please contact your property management company directly through their main office.",
        requestCreated: false,
        conversationId: conversationId
      });
    }
  } catch (error) {
    console.error('Error in handleGetContactInformation:', error);
    return res.json({
      message: "I encountered an error retrieving contact information. Please try again or contact your property management company directly.",
      requestCreated: false,
      conversationId: conversationId
    });
  }
}

async function handleRescheduleAppointment(functionArgs, userId, res, supabase, openai, messages, functions, unitId, propertyId, conversationId = null) {
  try {
    const appointmentId = functionArgs.appointment_id;
    const reason = functionArgs.reason || '';

    if (!appointmentId) {
      return res.json({
        message: "I need the appointment ID to reschedule. Can you tell me which appointment you'd like to reschedule?",
        requestCreated: false,
        conversationId: conversationId
      });
    }

    // Get appointment details and verify it belongs to this tenant
    const { data: appointment, error: appointmentError } = await supabase
      .from('client_appointments')
      .select(`
        appointment_id,
        client_id,
        vendor_id,
        maintenance_request_id,
        status,
        scheduled_date_time,
        vendors!inner(company_name)
      `)
      .eq('appointment_id', appointmentId)
      .single();

    if (appointmentError || !appointment) {
      return res.json({
        message: `I couldn't find appointment ${appointmentId}. Please check the appointment ID and try again.`,
        requestCreated: false,
        conversationId: conversationId
      });
    }

    // Verify the appointment belongs to this tenant
    const { data: client } = await supabase
      .from('clients')
      .select('client_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!client || appointment.client_id !== client.client_id) {
      return res.json({
        message: "I can only help you reschedule appointments that belong to you. Please verify the appointment ID.",
        requestCreated: false,
        conversationId: conversationId
      });
    }

    if (appointment.status !== 'scheduled') {
      return res.json({
        message: `This appointment cannot be rescheduled because its status is "${appointment.status}". Only scheduled appointments can be rescheduled.`,
        requestCreated: false,
        conversationId: conversationId
      });
    }

    // Update appointment status to 'rescheduled'
    const { error: updateError } = await supabase
      .from('client_appointments')
      .update({ 
        status: 'rescheduled',
        notes: reason ? `Rescheduling requested by tenant: ${reason}` : 'Rescheduling requested by tenant',
        updated_at: new Date().toISOString()
      })
      .eq('appointment_id', appointmentId);

    if (updateError) {
      console.error('Error updating appointment:', updateError);
      return res.json({
        message: "I encountered an error updating the appointment. Please try again or contact support.",
        requestCreated: false,
        conversationId: conversationId
      });
    }

    // Get vendor phone for calling
    const { data: vendorContact } = await supabase
      .from('contacts')
      .select('contact_id')
      .eq('contactable_id', appointment.vendor_id)
      .eq('contactable_type', 'vendor')
      .limit(1)
      .maybeSingle();

    if (vendorContact) {
      const { data: vendorMethods } = await supabase
        .from('contact_methods')
        .select('value, method_type')
        .eq('contact_id', vendorContact.contact_id)
        .in('method_type', ['Phone', 'phone', 'Cell', 'cell', 'Mobile', 'mobile'])
        .limit(1)
        .maybeSingle();

      if (vendorMethods) {
        // Trigger vendor call via cron endpoint (async, don't wait)
        fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/cron/call-vendors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            maintenance_request_id: appointment.maintenance_request_id,
            action: 'reschedule'
          })
        }).catch(err => console.error('Error triggering vendor call:', err));
      }
    }

    const scheduledDate = new Date(appointment.scheduled_date_time).toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });

    return res.json({
      message: `I've requested to reschedule your appointment with ${appointment.vendors.company_name} that was scheduled for ${scheduledDate}. ${reason ? `Reason: ${reason}. ` : ''}The vendor will be contacted to find a new appointment time, and you'll be notified once a new time is scheduled.`,
      requestCreated: false
    });
  } catch (error) {
    console.error('Error in handleRescheduleAppointment:', error);
    return res.json({
      message: "I encountered an error processing your reschedule request. Please try again or contact support.",
      requestCreated: false,
      conversationId: conversationId
    });
  }
}

async function handleFunctionCall(message, messages, unitId, userId, propertyId, res, functions, supabase, openai, recursionDepth = 0, conversationId = null) {
  // Prevent infinite recursion
  if (recursionDepth > 5) {
    // Update conversation transcript
    if (conversationId) {
      const updatedMessages = [
        ...messages,
        {
          role: 'assistant',
          content: 'Maximum processing depth reached. Please try again with a simpler request.'
        }
      ];
      await supabase
        .from('chatbot_conversations')
        .update({ transcript: JSON.stringify(updatedMessages) })
        .eq('conversation_id', conversationId);
    }
    
    return res.status(500).json({ 
      error: 'Maximum processing depth reached. Please try again with a simpler request.',
      requestCreated: false,
      conversationId: conversationId
    });
  }

  const functionName = message.function_call.name;
  const functionArgs = JSON.parse(message.function_call.arguments);

      if (functionName === 'assess_urgency') {
        return handleAssessUrgency(functionArgs, messages, res, functions, unitId, userId, propertyId, supabase, openai, recursionDepth, 0, conversationId);
      } else if (functionName === 'find_emergency_vendors') {
        return handleFindEmergencyVendors(functionArgs.keywords, propertyId, messages, res, functions, unitId, userId, supabase, openai, recursionDepth, conversationId);
      } else if (functionName === 'find_routine_vendors') {
        // Prevent calling find_routine_vendors - vendors are auto-assigned
        // Return a message telling the AI to proceed to confirmation instead
        const updatedMessages = [
          ...messages,
          {
            role: 'function',
            name: 'find_routine_vendors',
            content: JSON.stringify({ 
              error: 'This function should not be called. Vendors are automatically assigned when creating maintenance requests.'
            })
          }
        ];
        
        const response = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            ...updatedMessages,
            {
              role: 'system',
              content: 'You tried to call find_routine_vendors, but vendors are automatically assigned when creating maintenance requests. Do NOT call this function. Instead, proceed to Step 4: ask the tenant for confirmation to create the maintenance request. Vendors will be automatically assigned during request creation.'
            }
          ],
          functions: functions.filter(f => f.name !== 'find_routine_vendors'),
          function_call: 'none',
          temperature: 0.7,
          max_tokens: 300
        });
        
        // Update conversation transcript
        if (conversationId) {
          const finalMessages = [
            ...updatedMessages,
            {
              role: 'assistant',
              content: response.choices[0].message.content || 'I\'ll ask about your scheduling preferences, then create the maintenance request.'
            }
          ];
          await supabase
            .from('chatbot_conversations')
            .update({ transcript: JSON.stringify(finalMessages) })
            .eq('conversation_id', conversationId);
        }
        
        return res.json({
          message: response.choices[0].message.content || 'I\'ll ask about your scheduling preferences, then create the maintenance request.',
          requestCreated: false,
          conversationId: conversationId
        });
      } else if (functionName === 'create_maintenance_request') {
        return handleCreateMaintenanceRequest(functionArgs, unitId, userId, messages, res, functions, supabase, openai, null, conversationId, null); // conversationId passed, req will be null in recursive calls
      } else if (functionName === 'get_contact_information') {
        return handleGetContactInformation(functionArgs, propertyId, res, supabase, conversationId);
      } else if (functionName === 'list_appointments') {
        return handleListAppointments(userId, functionArgs, res, supabase, conversationId);
      } else if (functionName === 'reschedule_appointment') {
        return handleRescheduleAppointment(functionArgs, userId, res, supabase, openai, messages, functions, unitId, propertyId, conversationId);
      }

  // Unknown function - log error and return helpful message
  console.error('Unknown function call:', functionName);
  return res.json({ 
    error: `I encountered an unexpected error processing your request. Please try rephrasing your message or contact support if the issue persists.`,
    requestCreated: false 
  });
}


