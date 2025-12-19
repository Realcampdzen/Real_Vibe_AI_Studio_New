// Chat functionality for AI Studio

let chatOpen = false;
let messageHistory = [];

// Open chat widget
function openChat() {
  const chatWidget = document.getElementById('chat-widget');
  const chatButton = document.getElementById('chat-button');
  
  if (chatWidget && chatButton) {
    chatWidget.classList.remove('hidden');
    chatButton.classList.add('hidden');
    chatOpen = true;
    
    // Focus on input
    setTimeout(() => {
      const input = document.getElementById('chat-input');
      if (input) input.focus();
    }, 100);
  }
}

// Close chat widget
function closeChat() {
  const chatWidget = document.getElementById('chat-widget');
  const chatButton = document.getElementById('chat-button');
  
  if (chatWidget && chatButton) {
    chatWidget.classList.add('hidden');
    chatButton.classList.remove('hidden');
    chatOpen = false;
  }
}

// Add message to chat
function addMessage(text, isUser = false) {
  const messagesContainer = document.getElementById('chat-messages');
  if (!messagesContainer) return;
  
  const messageDiv = document.createElement('div');
  messageDiv.className = isUser ? 'flex items-start space-x-2 justify-end' : 'flex items-start space-x-2';
  
  if (isUser) {
    messageDiv.innerHTML = `
      <div class="bg-indigo-600 text-white p-3 rounded-lg shadow-sm max-w-[80%]">
        <p class="text-sm">${escapeHtml(text)}</p>
      </div>
      <div class="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 text-lg">
        👤
      </div>
    `;
  } else {
    messageDiv.innerHTML = `
      <div class="w-8 h-8 bg-orange-400 rounded-full flex items-center justify-center flex-shrink-0 text-lg">
        🐱
      </div>
      <div class="bg-white p-3 rounded-lg shadow-sm max-w-[80%]">
        <p class="text-sm text-gray-800 whitespace-pre-wrap">${escapeHtml(text)}</p>
      </div>
    `;
  }
  
  messagesContainer.appendChild(messageDiv);
  
  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Add typing indicator
function addTypingIndicator() {
  const messagesContainer = document.getElementById('chat-messages');
  if (!messagesContainer) return;
  
  const typingDiv = document.createElement('div');
  typingDiv.id = 'typing-indicator';
  typingDiv.className = 'flex items-start space-x-2';
  typingDiv.innerHTML = `
    <div class="w-8 h-8 bg-orange-400 rounded-full flex items-center justify-center flex-shrink-0 text-lg">
      🐱
    </div>
    <div class="bg-white p-3 rounded-lg shadow-sm">
      <div class="flex space-x-1">
        <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
        <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.1s"></div>
        <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
      </div>
    </div>
  `;
  
  messagesContainer.appendChild(typingDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Remove typing indicator
function removeTypingIndicator() {
  const typingIndicator = document.getElementById('typing-indicator');
  if (typingIndicator) {
    typingIndicator.remove();
  }
}

// Send message to API
async function sendMessage(message) {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message })
    });
    
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    
    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error('Error sending message:', error);
    return '😿 Упс! Что-то пошло не так. Попробуй еще раз или напиши напрямую: @Stivanovv';
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Handle form submission
function initChat() {
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  
  if (chatForm && chatInput) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const message = chatInput.value.trim();
      if (!message) return;
      
      // Add user message
      addMessage(message, true);
      messageHistory.push({ role: 'user', content: message });
      
      // Clear input
      chatInput.value = '';
      
      // Show typing indicator
      addTypingIndicator();
      
      // Send to API
      const response = await sendMessage(message);
      
      // Remove typing indicator
      removeTypingIndicator();
      
      // Add bot response
      addMessage(response, false);
      messageHistory.push({ role: 'assistant', content: response });
    });
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initChat();
});
