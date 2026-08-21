import React, { useState, useEffect, useContext, useCallback } from 'react';
import { MessageSquare, Phone, Clock, AlertCircle, CheckCircle, X, Trash2, User, Building2, Calendar, Copy } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { AuthContext } from '../contexts';
import { Card, ConfirmationModal } from './ui';
import { formatUnitAtProperty } from '../utils/unit-display.js';

export default function ConversationReview() {
  const { user } = useContext(AuthContext);
  const [conversations, setConversations] = useState([]);
  const [filteredConversations, setFilteredConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'incomplete', 'complete'
  const [searchTerm, setSearchTerm] = useState('');
  const [conversationToDelete, setConversationToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearMode, setClearMode] = useState('all'); // 'all', 'before_date', 'closed_completed'
  const [clearBeforeDate, setClearBeforeDate] = useState('');
  const [isClearing, setIsClearing] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const fetchConversations = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch all conversations, including incomplete ones (where user_id might be null)
      // Note: After migration, we can filter by is_incomplete column
      const { data, error } = await supabase
        .from('chatbot_conversations')
        .select(`
          conversation_id,
          user_id,
          unit_id,
          transcript,
          maintenance_request_id,
          created_at,
          ended_at,
          feedback_rating,
          feedback_comment,
          caller_phone,
          is_incomplete,
          call_id,
          duration,
          ended_reason,
          users:user_id (
            user_id,
            email
          ),
          units:unit_id (
            unit_id,
            unit_number,
            properties:property_id (
              property_id,
              property_name
            )
          )
        `)
        .order('created_at', { ascending: false })
        .limit(100);
      
      // Fetch contacts for users who have conversations
      if (data && data.length > 0) {
        const userIds = data.filter(c => c.user_id).map(c => c.user_id);
        if (userIds.length > 0) {
          // Get client_ids for these users
          const { data: clients } = await supabase
            .from('clients')
            .select('client_id, user_id')
            .in('user_id', userIds)
          
          if (clients && clients.length > 0) {
            const clientIds = clients.map(c => c.client_id);
            // Get contacts for these clients
            const { data: contacts } = await supabase
              .from('contacts')
              .select('contactable_id, first_name, last_name')
              .in('contactable_id', clientIds)
              .eq('contactable_type', 'tenant');
            
            // Map contacts to conversations
            if (contacts) {
              data.forEach(conv => {
                if (conv.user_id) {
                  const client = clients.find(c => c.user_id === conv.user_id);
                  if (client) {
                    const contact = contacts.find(c => c.contactable_id === client.client_id);
                    if (contact) {
                      conv.users = {
                        ...conv.users,
                        first_name: contact.first_name,
                        last_name: contact.last_name
                      };
                    }
                  }
                }
              });
            }
          }
        }
      }

      if (error) {
        console.error('Error fetching conversations:', error);
        setConversations([]);
      } else {
        setConversations(data || []);
      }
    } catch (error) {
      console.error('Error fetching conversations:', error);
      setConversations([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const filterConversations = useCallback(() => {
    let filtered = [...conversations];

    // Filter by type
    if (filter === 'incomplete') {
      // Check if is_incomplete column exists, otherwise check if user_id is null or metadata in transcript
      filtered = filtered.filter(conv => {
        if (conv.is_incomplete !== undefined) {
          return conv.is_incomplete === true;
        }
        // Fallback: check if user_id is null or if transcript contains incomplete call metadata
        if (!conv.user_id) return true;
        if (conv.transcript && typeof conv.transcript === 'string') {
          try {
            const transcript = JSON.parse(conv.transcript);
            return transcript.some(msg => {
              if (msg.role !== 'system') return false;
              const content = msg.content || msg.message || msg.text || '';
              return content.includes('[INCOMPLETE CALL METADATA]');
            });
          } catch {
            return false;
          }
        }
        return false;
      });
    } else if (filter === 'complete') {
      filtered = filtered.filter(conv => {
        if (conv.is_incomplete !== undefined) {
          return conv.is_incomplete === false;
        }
        // Fallback: check if user_id exists and no incomplete metadata
        if (!conv.user_id) return false;
        if (conv.transcript && typeof conv.transcript === 'string') {
          try {
            const transcript = JSON.parse(conv.transcript);
            return !transcript.some(msg => {
              if (msg.role !== 'system') return false;
              const content = msg.content || msg.message || msg.text || '';
              return content.includes('[INCOMPLETE CALL METADATA]');
            });
          } catch {
            return true;
          }
        }
        return true;
      });
    }

    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(conv => {
        // Search in caller phone
        if (conv.caller_phone && conv.caller_phone.toLowerCase().includes(term)) {
          return true;
        }
        // Search in user name/email
        if (conv.users) {
          const userName = `${conv.users.first_name || ''} ${conv.users.last_name || ''}`.toLowerCase();
          const userEmail = (conv.users.email || '').toLowerCase();
          if (userName.includes(term) || userEmail.includes(term)) {
            return true;
          }
        }
        // Search in unit/property info
        if (conv.units) {
          const unitNumber = (conv.units.unit_number || '').toLowerCase();
          const propertyName = (conv.units.properties?.property_name || '').toLowerCase();
          if (unitNumber.includes(term) || propertyName.includes(term)) {
            return true;
          }
        }
        // Search in date
        const dateStr = new Date(conv.created_at).toLocaleString().toLowerCase();
        if (dateStr.includes(term)) {
          return true;
        }
        // Search in maintenance request ID
        if (conv.maintenance_request_id && conv.maintenance_request_id.toString().includes(term)) {
          return true;
        }
        // Search in transcript
        if (conv.transcript) {
          try {
            const transcript = typeof conv.transcript === 'string' 
              ? JSON.parse(conv.transcript) 
              : conv.transcript;
            const transcriptText = JSON.stringify(transcript).toLowerCase();
            if (transcriptText.includes(term)) {
              return true;
            }
          } catch {
            // Ignore parse errors
          }
        }
        return false;
      });
    }

    setFilteredConversations(filtered);
  }, [conversations, filter, searchTerm]);

  useEffect(() => {
    if (user) {
      fetchConversations();
    }
  }, [user, fetchConversations]);

  useEffect(() => {
    filterConversations();
  }, [filterConversations]);

  // Clear selected conversation if it's filtered out
  useEffect(() => {
    if (selectedConversation && !filteredConversations.find(c => c.conversation_id === selectedConversation.conversation_id)) {
      setSelectedConversation(null);
    }
  }, [filteredConversations, selectedConversation]);

  const parseTranscript = (transcript) => {
    if (!transcript) return [];
    if (typeof transcript === 'string') {
      try {
        return JSON.parse(transcript);
      } catch {
        return [];
      }
    }
    return transcript;
  };

  const extractIncompleteMetadata = (transcript) => {
    const parsed = parseTranscript(transcript);
    const metadataMsg = parsed.find(msg => {
      if (msg.role !== 'system') return false;
      const content = msg.content || msg.message || msg.text || '';
      return content.includes('[INCOMPLETE CALL METADATA]');
    });
    if (metadataMsg) {
      const content = metadataMsg.content || metadataMsg.message || metadataMsg.text || '';
      const phoneMatch = content.match(/Caller Phone: ([^,]+)/);
      const callIdMatch = content.match(/Call ID: ([^,]+)/);
      const durationMatch = content.match(/Duration: ([^,]+)/);
      const reasonMatch = content.match(/Ended Reason: ([^,]+)/);
      return {
        callerPhone: phoneMatch ? phoneMatch[1].trim() : null,
        callId: callIdMatch ? callIdMatch[1].trim() : null,
        duration: durationMatch ? durationMatch[1].trim() : null,
        endedReason: reasonMatch ? reasonMatch[1].trim() : null
      };
    }
    return null;
  };

  const formatDuration = (seconds) => {
    if (!seconds) return 'Unknown';
    if (typeof seconds === 'string') {
      if (seconds === 'Unknown') return seconds;
      seconds = parseInt(seconds);
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const handleDeleteClick = (conversationId) => {
    setConversationToDelete(conversationId);
  };

  const handleDeleteConfirm = async () => {
    if (!conversationToDelete) return;

    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('chatbot_conversations')
        .delete()
        .eq('conversation_id', conversationToDelete);

      if (error) {
        console.error('Error deleting conversation:', error);
        setDeleteError('Failed to delete conversation. Please try again.');
        setIsDeleting(false);
        return;
      } else {
        setConversations(conversations.filter(c => c.conversation_id !== conversationToDelete));
        if (selectedConversation?.conversation_id === conversationToDelete) {
          setSelectedConversation(null);
        }
        setConversationToDelete(null);
        setDeleteError('');
        setIsDeleting(false);
      }
    } catch (error) {
      console.error('Error deleting conversation:', error);
      setDeleteError('Failed to delete conversation. Please try again.');
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <div className="p-6 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading conversations...</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-gray-800">Voice Call Conversations</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setShowClearModal(true)}
            className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100"
          >
            Clear
          </button>
          <button
            onClick={fetchConversations}
            className="px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-md hover:bg-indigo-100"
          >
            Refresh
          </button>
        </div>
      </div>

      {deleteError && (
        <div className="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md">
          {deleteError}
          <button
            onClick={() => setDeleteError('')}
            className="ml-2 text-red-600 hover:text-red-800 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {copySuccess && (
        <div className="p-3 text-sm text-green-700 bg-green-100 border border-green-400 rounded-md flex items-center justify-between">
          <span>Conversation copied to clipboard!</span>
          <button
            onClick={() => setCopySuccess(false)}
            className="text-green-600 hover:text-green-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Filters */}
      <Card>
        <div className="p-4 space-y-4">
          <div className="flex gap-4 items-center">
            <label className="text-sm font-medium text-gray-700">Filter:</label>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Conversations</option>
              <option value="incomplete">Incomplete Calls</option>
              <option value="complete">Complete Calls</option>
            </select>
          </div>
          <div className="flex gap-4 items-center">
            <label className="text-sm font-medium text-gray-700">Search:</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by phone, name, email, or transcript..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Conversation List */}
        <Card>
          <div className="p-4 border-b border-gray-200">
            <h4 className="font-semibold text-gray-800">
              Conversations ({filteredConversations.length})
            </h4>
          </div>
          <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
            {filteredConversations.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                No conversations found
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isIncomplete = conv.is_incomplete || !conv.user_id || 
                  (conv.transcript && typeof conv.transcript === 'string' && 
                   JSON.parse(conv.transcript || '[]').some(msg => {
                     if (msg.role !== 'system') return false;
                     const content = msg.content || msg.message || msg.text || '';
                     return content.includes('[INCOMPLETE CALL METADATA]');
                   }));
                const metadata = extractIncompleteMetadata(conv.transcript);
                const transcript = parseTranscript(conv.transcript);
                const userMessages = transcript.filter(m => m.role === 'user');
                const firstUserMessage = userMessages.length > 0 ? userMessages[0] : null;
                const previewText = firstUserMessage 
                  ? (firstUserMessage.content || firstUserMessage.message || firstUserMessage.text || '')
                  : '';
                const preview = previewText 
                  ? previewText.substring(0, 100) 
                  : 'No user messages';

                return (
                  <div
                    key={conv.conversation_id}
                    onClick={() => setSelectedConversation(conv)}
                    className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedConversation?.conversation_id === conv.conversation_id
                        ? 'bg-indigo-50 border-l-4 border-indigo-500'
                        : ''
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          {isIncomplete ? (
                            <AlertCircle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                          ) : (
                            <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                          )}
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {isIncomplete ? 'Incomplete Call' : 'Complete Call'}
                          </span>
                        </div>
                        <div className="text-sm text-gray-600 space-y-1">
                          {metadata?.callerPhone && (
                            <div className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              <span>{metadata.callerPhone}</span>
                            </div>
                          )}
                          {conv.users && (
                            <div className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              <span>
                                {conv.users.first_name} {conv.users.last_name}
                                {conv.users.email && ` (${conv.users.email})`}
                              </span>
                            </div>
                          )}
                          {conv.units && (
                            <div className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              <span>
                                {formatUnitAtProperty(conv.units, conv.units.properties?.property_name)}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            <span>{new Date(conv.created_at).toLocaleString()}</span>
                          </div>
                          {metadata?.duration && (
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              <span>{formatDuration(metadata.duration)}</span>
                            </div>
                          )}
                        </div>
                        <p className="mt-2 text-xs text-gray-500 truncate">{preview}...</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteClick(conv.conversation_id);
                        }}
                        className="ml-2 p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                        title="Delete conversation"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Conversation Detail */}
        <Card>
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-gray-800">Conversation Details</h4>
              {selectedConversation && (
                <button
                  onClick={() => setSelectedConversation(null)}
                  className="p-1 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
          <div className="p-4">
            {!selectedConversation ? (
              <div className="text-center text-gray-500 py-8">
                Select a conversation to view details
              </div>
            ) : (
              <div className="space-y-4">
                {/* Metadata */}
                <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                  <h5 className="font-semibold text-sm text-gray-700">Call Information</h5>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-gray-600">Status:</span>{' '}
                      <span className="font-medium">
                        {(selectedConversation.is_incomplete || !selectedConversation.user_id) ? 'Incomplete' : 'Complete'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Created:</span>{' '}
                      <span className="font-medium">
                        {new Date(selectedConversation.created_at).toLocaleString()}
                      </span>
                    </div>
                    {selectedConversation.ended_at && (
                      <div>
                        <span className="text-gray-600">Ended:</span>{' '}
                        <span className="font-medium">
                          {new Date(selectedConversation.ended_at).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {selectedConversation.feedback_rating && (
                      <div>
                        <span className="text-gray-600">Rating:</span>{' '}
                        <span className="font-medium">
                          {'⭐'.repeat(selectedConversation.feedback_rating)}
                        </span>
                      </div>
                    )}
                  </div>
                  {(() => {
                    const metadata = extractIncompleteMetadata(selectedConversation.transcript);
                    if (metadata || selectedConversation.caller_phone) {
                      return (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <h6 className="font-semibold text-xs text-gray-700 mb-2">Incomplete Call Details</h6>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-gray-600">Caller Phone:</span>{' '}
                              <span className="font-medium">
                                {selectedConversation.caller_phone || metadata?.callerPhone || 'Unknown'}
                              </span>
                            </div>
                            {metadata?.callId && (
                              <div>
                                <span className="text-gray-600">Call ID:</span>{' '}
                                <span className="font-medium">{metadata.callId}</span>
                              </div>
                            )}
                            {metadata?.duration && (
                              <div>
                                <span className="text-gray-600">Duration:</span>{' '}
                                <span className="font-medium">{formatDuration(metadata.duration)}</span>
                              </div>
                            )}
                            {metadata?.endedReason && (
                              <div>
                                <span className="text-gray-600">Ended Reason:</span>{' '}
                                <span className="font-medium">{metadata.endedReason}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>

                {/* Transcript */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="font-semibold text-sm text-gray-700">Transcript</h5>
                    <button
                      onClick={() => {
                        const transcript = parseTranscript(selectedConversation.transcript)
                          .filter((msg, idx, arr) => {
                            if (msg.role === 'system' || msg.role === 'bot') {
                              const content = msg.content || msg.message || msg.text || '';
                              if (content.includes('[INCOMPLETE CALL METADATA]')) return false;
                              const isFirstSystem = arr.slice(0, idx).every(m => m.role !== 'system' && m.role !== 'bot');
                              const isLongPrompt = content.length > 200 && (
                                content.includes('You are a helpful maintenance assistant') ||
                                content.includes('Your role is to:') ||
                                content.includes('CALLER IDENTIFICATION FLOW')
                              );
                              if (isFirstSystem && isLongPrompt) return false;
                            }
                            return true;
                          })
                          .map(msg => {
                            const role = msg.role === 'user' ? 'Caller' : msg.role === 'assistant' ? 'Assistant' : 'System';
                            const content = msg.content || msg.message || msg.text || '';
                            return `${role}\n${content}`;
                          })
                          .join('\n\n');
                        navigator.clipboard.writeText(transcript).then(() => {
                          setCopySuccess(true);
                          setTimeout(() => setCopySuccess(false), 3000);
                        }).catch(err => {
                          console.error('Failed to copy:', err);
                        });
                      }}
                      className="px-3 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-md hover:bg-indigo-100"
                    >
                      Copy Transcript
                    </button>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-lg p-4 max-h-[400px] overflow-y-auto space-y-3">
                    {parseTranscript(selectedConversation.transcript)
                      .filter((msg, idx, arr) => {
                        // Filter both 'system' and 'bot' messages (bot messages are displayed as 'System' in UI)
                        if (msg.role === 'system' || msg.role === 'bot') {
                          const content = msg.content || msg.message || msg.text || '';
                          // Normalize: lowercase, trim, remove extra whitespace
                          const normalizedContent = content.toLowerCase().trim().replace(/\s+/g, ' ');
                          
                          // Filter out incomplete call metadata
                          if (content.includes('[INCOMPLETE CALL METADATA]')) {
                            return false;
                          }
                          
                          // Filter out system prompts (typically very long and contain instruction text)
                          // System prompts are usually the first system message and are > 200 characters
                          const isFirstSystem = arr.slice(0, idx).every(m => m.role !== 'system' && m.role !== 'bot');
                          const isLongPrompt = content.length > 200 && (
                            content.includes('You are a helpful maintenance assistant') ||
                            content.includes('Your role is to:') ||
                            content.includes('CALLER IDENTIFICATION FLOW')
                          );
                          if (isFirstSystem && isLongPrompt) {
                            return false;
                          }
                          
                          // Check if content is empty or whitespace only
                          // The display code shows "(No content)" when all three fields are falsy
                          // So we need to filter out messages where all content fields are empty/falsy or only whitespace
                          const rawContent = msg.content || msg.message || msg.text || '';
                          const hasAnyContent = !!rawContent && rawContent.trim().length > 0;
                          if (!hasAnyContent || !normalizedContent || normalizedContent.length === 0) {
                            return false;
                          }
                          
                          // Filter out short status messages (apply to ALL system messages)
                          // Use regex patterns to catch variations in capitalization, punctuation, and whitespace
                          const statusPatterns = [
                            /^\(no\s+content\)$/i,                  // (No content) or (no content) - with space
                            /^\(no\s*content\)$/i,                  // (No content) or (nocontent) - optional space
                            /^just\s+a\s+sec\.?$/i,                 // Just a sec. or just a sec
                            /^give\s+me\s+a\s+moment\.?$/i,         // Give me a moment. or give me a moment
                            /^this\s+will\s+just\s+take\s+a\s+sec\.?$/i, // This will just take a sec.
                            /^hold\s+on\s+a\s+sec\.?$/i,            // Hold on a sec. or hold on a sec
                            /^just\s+a\s+moment\.?$/i,              // Just a moment
                            /^hold\s+on\s+a\s+moment\.?$/i,         // Hold on a moment
                            /^one\s+moment\.?$/i,                    // One moment
                            /^one\s+sec\.?$/i,                       // One sec
                            /^hold\s+on\.?$/i,                       // Hold on
                            /^wait\s+a\s+moment\.?$/i,               // Wait a moment
                            /^wait\s+a\s+sec\.?$/i                  // Wait a sec
                          ];
                          
                          // Check if content matches any status pattern (exact match with regex)
                          // Test both normalized and original content to catch all case variations
                          const originalContent = content.trim();
                          const matchesStatusPattern = statusPatterns.some(pattern => {
                            const normalizedMatch = pattern.test(normalizedContent);
                            const originalMatch = pattern.test(originalContent);
                            return normalizedMatch || originalMatch;
                          });
                          
                          if (matchesStatusPattern) {
                            return false;
                          }
                          
                          // Also filter out very short system messages that contain status keywords
                          // This catches any short message with status-related words, regardless of exact format
                          if (normalizedContent.length < 30) {
                            const statusKeywords = ['sec', 'moment', 'wait', 'hold', 'no content'];
                            const hasStatusKeyword = statusKeywords.some(keyword => normalizedContent.includes(keyword));
                            if (hasStatusKeyword) {
                              return false;
                            }
                          }
                          
                          // Additional check: if content is just parentheses with "no content" (case-insensitive)
                          // This catches variations like "(No content)", "(no content)", etc. with any whitespace
                          // Check both normalized and original content to catch all variations
                          const noContentPattern1 = /^\(.*no\s+content.*\)$/i.test(normalizedContent);
                          const noContentPattern2 = /^\(no\s+content\)$/i.test(normalizedContent);
                          const noContentPattern3 = /^\(.*no\s+content.*\)$/i.test(content.trim());
                          const noContentPattern4 = /^\(no\s+content\)$/i.test(content.trim());
                          if (noContentPattern1 || noContentPattern2 || noContentPattern3 || noContentPattern4) {
                            return false;
                          }
                          
                          // Final check: if the display content would be "(No content)", filter it out
                          const displayContent = msg.content || msg.message || msg.text || '';
                          if (!displayContent || displayContent.trim().length === 0) {
                            return false;
                          }
                        }
                        
                        // Filter out any message that would display as "System" but has no content
                        // The display code shows anything that's not 'user' or 'assistant' as 'System'
                        const wouldDisplayAsSystem = msg.role !== 'user' && msg.role !== 'assistant';
                        if (wouldDisplayAsSystem) {
                          const displayContent = msg.content || msg.message || msg.text || '';
                          if (!displayContent || displayContent.trim().length === 0) {
                            return false;
                          }
                        }
                        
                        return true;
                      })
                      .map((msg, idx) => (
                        <div
                          key={idx}
                          className={`flex gap-3 ${
                            msg.role === 'user' ? 'flex-row-reverse' : ''
                          }`}
                        >
                          <div
                            className={`flex-1 rounded-lg p-3 ${
                              msg.role === 'user'
                                ? 'bg-indigo-100 text-indigo-900'
                                : msg.role === 'assistant'
                                ? 'bg-gray-100 text-gray-900'
                                : 'bg-yellow-50 text-yellow-900'
                            }`}
                          >
                            <div className="text-xs font-semibold mb-1 opacity-75">
                              {msg.role === 'user' ? 'Caller' : msg.role === 'assistant' ? 'Assistant' : 'Assistant'}
                            </div>
                            <div className="text-sm whitespace-pre-wrap">
                              {msg.content || msg.message || msg.text || '(No content)'}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Actions */}
                {selectedConversation.maintenance_request_id && (
                  <div className="pt-4 border-t border-gray-200">
                    <a
                      href={`/maintenance?request=${selectedConversation.maintenance_request_id}`}
                      className="text-sm text-indigo-600 hover:text-indigo-800"
                    >
                      View Maintenance Request #{selectedConversation.maintenance_request_id}
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>
      
      <ConfirmationModal
        isOpen={!!conversationToDelete}
        onClose={() => setConversationToDelete(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Conversation"
        message="Are you sure you want to delete this conversation? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        isDestructive={true}
        isLoading={isDeleting}
      />

      {/* Clear Conversations Modal */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Clear Conversations</h2>
            
            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Clear Options
                </label>
                <select
                  value={clearMode}
                  onChange={(e) => setClearMode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">Clear All Conversations</option>
                  <option value="before_date">Clear Before Date</option>
                  <option value="closed_completed">Clear Closed/Completed Requests</option>
                </select>
              </div>

              {clearMode === 'before_date' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Clear conversations before this date
                  </label>
                  <input
                    type="date"
                    value={clearBeforeDate}
                    onChange={(e) => setClearBeforeDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              {clearMode === 'closed_completed' && (
                <p className="text-sm text-gray-600">
                  This will clear conversations associated with maintenance requests that are closed or completed.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowClearModal(false);
                  setClearMode('all');
                  setClearBeforeDate('');
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setIsClearing(true);
                  try {
                    let conversationIdsToDelete = [];

                    if (clearMode === 'all') {
                      conversationIdsToDelete = conversations.map(c => c.conversation_id);
                    } else if (clearMode === 'before_date') {
                      if (!clearBeforeDate) {
                        alert('Please select a date');
                        setIsClearing(false);
                        return;
                      }
                      const cutoffDate = new Date(clearBeforeDate);
                      conversationIdsToDelete = conversations
                        .filter(c => new Date(c.created_at) < cutoffDate)
                        .map(c => c.conversation_id);
                    } else if (clearMode === 'closed_completed') {
                      // Get maintenance request IDs that are closed or completed
                      const { data: closedRequests } = await supabase
                        .from('maintenance_requests')
                        .select('request_id')
                        .in('status', ['Completed', 'Closed']);
                      
                      const closedRequestIds = (closedRequests || []).map(r => r.request_id);
                      
                      conversationIdsToDelete = conversations
                        .filter(c => c.maintenance_request_id && closedRequestIds.includes(c.maintenance_request_id))
                        .map(c => c.conversation_id);
                    }

                    if (conversationIdsToDelete.length === 0) {
                      alert('No conversations match the selected criteria');
                      setIsClearing(false);
                      return;
                    }

                    // Delete conversations
                    const { error } = await supabase
                      .from('chatbot_conversations')
                      .delete()
                      .in('conversation_id', conversationIdsToDelete);

                    if (error) {
                      console.error('Error clearing conversations:', error);
                      alert('Failed to clear conversations. Please try again.');
                    } else {
                      // Refresh conversations
                      await fetchConversations();
                      setShowClearModal(false);
                      setClearMode('all');
                      setClearBeforeDate('');
                      if (selectedConversation && conversationIdsToDelete.includes(selectedConversation.conversation_id)) {
                        setSelectedConversation(null);
                      }
                    }
                  } catch (error) {
                    console.error('Error clearing conversations:', error);
                    alert('Failed to clear conversations. Please try again.');
                  } finally {
                    setIsClearing(false);
                  }
                }}
                disabled={isClearing}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {isClearing ? 'Clearing...' : 'Clear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

