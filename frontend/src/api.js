/**
 * API client for the LLM Council backend.
 */

// Dynamically determine API base URL based on current hostname
// This allows the app to work on both localhost and network IPs
const getApiBase = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  const hostname = window.location.hostname;
  return `http://${hostname}:8001`;
};

const API_BASE = getApiBase();

export const api = {
  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`);
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Rename a conversation.
   */
  async renameConversation(conversationId, title) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/title`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to rename conversation');
    }
    return response.json();
  },

  /**
   * Delete a conversation.
   */
  async deleteConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      throw new Error('Failed to delete conversation');
    }
    return response.json();
  },

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId, content, webSearch = false) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content, web_search: webSearch }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    return response.json();
  },

  /**
   * Get application settings.
   */
  async getSettings() {
    const response = await fetch(`${API_BASE}/api/settings`);
    if (!response.ok) {
      throw new Error('Failed to get settings');
    }
    return response.json();
  },

  /**
   * Test Tavily API key.
   */
  async testTavilyKey(apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/test-tavily`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to test API key');
    }
    return response.json();
  },

  /**
   * Test OpenRouter API key.
   */
  async testOpenRouterKey(apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/test-openrouter`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to test API key');
    }
    return response.json();
  },

  /**
   * Test Brave API key.
   */
  async testBraveKey(apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/test-brave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to test API key');
    }
    return response.json();
  },

  /**
   * Test Serper API key.
   */
  async testSerperKey(apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/test-serper`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to test API key');
    }
    return response.json();
  },

  /**
   * Test a specific provider's API key.
   */
  async testProviderKey(providerId, apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/test-provider`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider_id: providerId, api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to test API key');
    }
    return response.json();
  },

  /**
   * Test Ollama connection.
   */
  async testOllamaConnection(baseUrl) {
    const response = await fetch(`${API_BASE}/api/settings/test-ollama`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ base_url: baseUrl }),
    });
    if (!response.ok) {
      throw new Error('Failed to test Ollama connection');
    }
    return response.json();
  },

  /**
   * Test custom OpenAI-compatible endpoint.
   */
  async testCustomEndpoint(name, url, apiKey) {
    const response = await fetch(`${API_BASE}/api/settings/test-custom-endpoint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, url, api_key: apiKey }),
    });
    if (!response.ok) {
      throw new Error('Failed to test custom endpoint');
    }
    return response.json();
  },

  /**
   * Get available models from custom endpoint.
   */
  async getCustomEndpointModels() {
    const response = await fetch(`${API_BASE}/api/custom-endpoint/models`);
    if (!response.ok) {
      throw new Error('Failed to get custom endpoint models');
    }
    return response.json();
  },

  /**
   * Get available models from OpenRouter.
   */
  async getModels() {
    const response = await fetch(`${API_BASE}/api/models`);
    if (!response.ok) {
      throw new Error('Failed to get models');
    }
    return response.json();
  },

  /**
   * Get available models from Ollama.
   */
  async getOllamaModels(baseUrl) {
    let url = `${API_BASE}/api/ollama/tags`;
    if (baseUrl) {
      url += `?base_url=${encodeURIComponent(baseUrl)}`;
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to get Ollama models');
    }
    return response.json();
  },

  /**
   * Get available models from direct providers.
   */
  async getDirectModels() {
    const response = await fetch(`${API_BASE}/api/models/direct`);
    if (!response.ok) {
      throw new Error('Failed to get direct models');
    }
    return response.json();
  },

  /**
   * Get default model settings.
   */
  async getDefaultSettings() {
    const response = await fetch(`${API_BASE}/api/settings/defaults`);
    if (!response.ok) {
      throw new Error('Failed to get default settings');
    }
    return response.json();
  },

  /**
   * Update application settings.
   */
  async updateSettings(settings) {
    const response = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
    });
    if (!response.ok) {
      throw new Error('Failed to update settings');
    }
    return response.json();
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {Object} options - Message options
   * @param {string} options.content - The message content
   * @param {boolean} options.webSearch - Whether to use web search
   * @param {string} options.executionMode - Execution mode: 'chat_only', 'chat_ranking', or 'full'
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @param {AbortSignal} signal - Optional AbortSignal to cancel the request
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, options, onEvent, signal) {
    const { content, webSearch = false, executionMode = 'full' } = options;
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream?_t=${Date.now()}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify({ content, web_search: webSearch, execution_mode: executionMode }),
        signal,
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const event = JSON.parse(data);
              onEvent(event.type, event);
            } catch (e) {
              console.error('Failed to parse SSE event:', e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  /**
   * Upload a file to a conversation.
   * @param {string} conversationId
   * @param {File} file
   * @returns {Promise<Object>} File metadata (id, filename, original_name, type, mime_type, size)
   */
  async uploadFile(conversationId, file) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to upload file');
    }
    return response.json();
  },

  /**
   * Get the URL for a previously uploaded file.
   */
  getFileUrl(conversationId, filename) {
    return `${API_BASE}/api/files/${conversationId}/${filename}`;
  },

  /**
   * Start a debate and receive streaming updates.
   */
  async sendDebateStream(conversationId, options, onEvent, signal) {
    const { content, webSearch = false, fileIds = [], mode, chatModel } = options;
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/debate/stream?_t=${Date.now()}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify({
          content,
          web_search: webSearch,
          file_ids: fileIds.length > 0 ? fileIds : undefined,
          mode: mode || undefined,
          chat_model: chatModel || undefined,
        }),
        signal,
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      throw new Error('Failed to start debate');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const event = JSON.parse(data);
              onEvent(event.type, event);
            } catch (e) {
              console.error('Failed to parse SSE event:', e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  /**
   * Send an interjection to an active debate.
   */
  async sendInterjection(conversationId, content) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/interject`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send interjection');
    }
    return response.json();
  },

  // ── Campaign API ─────────────────────────────────────────────────────

  async createCampaign(name) {
    const response = await fetch(`${API_BASE}/api/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) throw new Error('Failed to create campaign');
    return response.json();
  },

  async listCampaigns() {
    const response = await fetch(`${API_BASE}/api/campaigns`);
    if (!response.ok) throw new Error('Failed to list campaigns');
    return response.json();
  },

  async getCampaign(campaignId) {
    const response = await fetch(`${API_BASE}/api/campaigns/${campaignId}`);
    if (!response.ok) throw new Error('Failed to get campaign');
    return response.json();
  },

  async updateCampaign(campaignId, updates) {
    const response = await fetch(`${API_BASE}/api/campaigns/${campaignId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update campaign');
    return response.json();
  },

  async deleteCampaign(campaignId) {
    const response = await fetch(`${API_BASE}/api/campaigns/${campaignId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete campaign');
    return response.json();
  },

  async addStage(campaignId, name) {
    const response = await fetch(`${API_BASE}/api/campaigns/${campaignId}/stages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) throw new Error('Failed to add stage');
    return response.json();
  },

  async reorderStages(campaignId, stageIds) {
    const response = await fetch(`${API_BASE}/api/campaigns/${campaignId}/stages/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage_ids: stageIds }),
    });
    if (!response.ok) throw new Error('Failed to reorder stages');
    return response.json();
  },

  async updateStage(campaignId, stageId, updates) {
    const response = await fetch(`${API_BASE}/api/campaigns/${campaignId}/stages/${stageId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update stage');
    return response.json();
  },

  async deleteStage(campaignId, stageId) {
    const response = await fetch(`${API_BASE}/api/campaigns/${campaignId}/stages/${stageId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete stage');
    return response.json();
  },

  async addStageConversation(campaignId, stageId) {
    const response = await fetch(`${API_BASE}/api/campaigns/${campaignId}/stages/${stageId}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error('Failed to add conversation to stage');
    return response.json();
  },

  // ── Campaign Sources ─────────────────────────────────────────────────

  async uploadCampaignSource(campaignId, file) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/api/campaigns/${campaignId}/sources`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to upload source');
    }
    return response.json();
  },

  async listCampaignSources(campaignId) {
    const response = await fetch(`${API_BASE}/api/campaigns/${campaignId}/sources`);
    if (!response.ok) throw new Error('Failed to list sources');
    return response.json();
  },

  async deleteCampaignSource(campaignId, sourceId) {
    const response = await fetch(`${API_BASE}/api/campaigns/${campaignId}/sources/${sourceId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete source');
    return response.json();
  },

  getCampaignSourceUrl(campaignId, sourceId) {
    return `${API_BASE}/api/campaigns/${campaignId}/sources/${sourceId}/file`;
  },
};
