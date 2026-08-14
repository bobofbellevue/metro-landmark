import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, X, MessageCircle } from 'lucide-react';

export default function MaintenanceChatBot({ user, unitId, onRequestCreated, initialOpen = false, inline = false }) {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [debugModel, setDebugModel] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      // Initialize with welcome message
      setMessages([{
        role: 'assistant',
        content: "Hi! I'm your maintenance assistant. I can help you report maintenance issues, assess urgency, and schedule repairs. What's the problem you're experiencing?"
      }]);
      setConversationId(null); // Reset conversation ID when opening new chat
      setShowFeedback(false);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);

    // Add user message
    const newMessages = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);

    try {
      const response = await fetch('/api/maintenance-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          userId: user.user_id,
          unitId: unitId,
          email: user.email,
          conversationId: conversationId
        })
      });

      // Check if response is ok before parsing JSON
      if (!response.ok) {
        let errorMessage = 'An error occurred processing your request';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          // If response is not JSON, try to get text
          try {
            const errorText = await response.text();
            errorMessage = errorText || errorMessage;
          } catch (e2) {
            // Use default error message
          }
        }
        setMessages([...newMessages, {
          role: 'assistant',
          content: `I'm sorry, I encountered an error: ${errorMessage}. Please try again or contact support.`
        }]);
        return;
      }

      const data = await response.json();

      if (data.error) {
        setMessages([...newMessages, {
          role: 'assistant',
          content: `I'm sorry, I encountered an error: ${data.error}. Please try again or contact support.`
        }]);
      } else {
        setMessages([...newMessages, {
          role: 'assistant',
          content: data.message
        }]);

        // Track conversation ID
        if (data.conversationId) {
          setConversationId(data.conversationId);
        }

        // Track debug model if provided
        if (data.debugModel) {
          setDebugModel(data.debugModel);
        }

        // If a maintenance request was created, show feedback form
        if (data.requestCreated) {
          if (onRequestCreated) {
            onRequestCreated();
          }
          // Show feedback form after a short delay
          setTimeout(() => {
            setShowFeedback(true);
          }, 1000);
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages([...newMessages, {
        role: 'assistant',
        content: "I'm sorry, I'm having trouble connecting right now. Please try again in a moment."
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    // Mark conversation as ended if we have a conversationId
    if (conversationId) {
      fetch('/api/chatbot-conversations/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId })
      }).catch(err => console.error('Error ending conversation:', err));
    }
    setIsOpen(false);
    setShowFeedback(false);
    setFeedbackRating(0);
    setFeedbackComment('');
  };

  const handleSubmitFeedback = async () => {
    if (!conversationId || feedbackRating === 0) return;
    
    setIsSubmittingFeedback(true);
    try {
      const response = await fetch('/api/chatbot-conversations/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          rating: feedbackRating,
          comment: feedbackComment
        })
      });

      if (response.ok) {
        setShowFeedback(false);
        setFeedbackRating(0);
        setFeedbackComment('');
      } else {
        console.error('Error submitting feedback');
      }
    } catch (error) {
      console.error('Error submitting feedback:', error);
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  if (!isOpen && !inline) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 flex items-center gap-2 px-6 py-3 text-white bg-indigo-600 rounded-full shadow-lg hover:bg-indigo-700 transition-colors z-50"
      >
        <MessageCircle size={20} />
        <span>Chat with Maintenance Assistant</span>
      </button>
    );
  }

  if (!isOpen && inline) {
    return null; // Don't show anything if inline and not open
  }

  return (
    <div className={`${inline ? 'w-full h-[600px]' : 'fixed bottom-6 right-6 w-96 h-[600px]'} bg-white rounded-lg shadow-2xl flex flex-col z-50 border border-gray-200`}>
      {/* Header */}
      <div className="bg-indigo-600 text-white rounded-t-lg">
        {debugModel && (
          <div className="px-4 pt-2 pb-1 text-xs bg-indigo-700/50">
            <span className="font-mono">Model: {debugModel}</span>
          </div>
        )}
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2">
            <Bot size={20} />
            <span className="font-semibold">Maintenance Assistant</span>
          </div>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-indigo-700 rounded transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="flex-shrink-0 w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                <Bot size={16} className="text-indigo-600" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-gray-800 border border-gray-200'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
            {msg.role === 'user' && (
              <div className="flex-shrink-0 w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                <User size={16} className="text-gray-600" />
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-2 justify-start">
            <div className="flex-shrink-0 w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
              <Bot size={16} className="text-indigo-600" />
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
        
        {/* Feedback Form */}
        {showFeedback && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="text-sm font-semibold text-gray-800 mb-2">How was your experience?</h4>
            <div className="flex items-center gap-2 mb-3">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  onClick={() => setFeedbackRating(rating)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-lg transition-colors ${
                    feedbackRating >= rating
                      ? 'bg-yellow-400 text-yellow-900'
                      : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                  }`}
                >
                  ★
                </button>
              ))}
            </div>
            <textarea
              value={feedbackComment}
              onChange={(e) => setFeedbackComment(e.target.value)}
              placeholder="Optional: Tell us what we did well or how we can improve..."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2"
              rows="2"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSubmitFeedback}
                disabled={isSubmittingFeedback || feedbackRating === 0}
                className="px-4 py-1 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmittingFeedback ? 'Submitting...' : 'Submit Feedback'}
              </button>
              <button
                onClick={() => setShowFeedback(false)}
                className="px-4 py-1 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Skip
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-4 border-t border-gray-200 bg-white rounded-b-lg">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-resize textarea
              const textarea = e.target;
              textarea.style.height = 'auto';
              textarea.style.height = Math.min(textarea.scrollHeight, 128) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            placeholder="Describe your maintenance issue..."
            rows={1}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none overflow-y-auto min-h-[44px] max-h-32"
            style={{ 
              height: 'auto',
              minHeight: '44px'
            }}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <Send size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}

