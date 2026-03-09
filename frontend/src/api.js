/**
 * API client for DM Debate Studio backend.
 * All requests include the Firebase Auth token.
 */

import { auth } from './firebase';

const getApiBase = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  const hostname = window.location.hostname;
  return `http://${hostname}:8001`;
};

const API_BASE = getApiBase();

async function getAuthHeaders() {
  const user = auth.currentUser;
  if (!user) return {};
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

async function authFetch(url, options = {}) {
  const headers = {
    ...options.headers,
    ...(await getAuthHeaders()),
  };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    window.dispatchEvent(new Event('auth-expired'));
  }
  return response;
}

export const api = {
  // ── Conversations ────────────────────────────────────────────────

  async listConversations() {
    const response = await authFetch(`${API_BASE}/api/conversations`);
    if (!response.ok) throw new Error('Failed to list conversations');
    return response.json();
  },

  async createConversation() {
    const response = await authFetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error('Failed to create conversation');
    return response.json();
  },

  async getConversation(conversationId) {
    const response = await authFetch(`${API_BASE}/api/conversations/${conversationId}`);
    if (!response.ok) throw new Error('Failed to get conversation');
    return response.json();
  },

  async renameConversation(conversationId, title) {
    const response = await authFetch(`${API_BASE}/api/conversations/${conversationId}/title`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) throw new Error('Failed to rename conversation');
    return response.json();
  },

  async deleteConversation(conversationId) {
    const response = await authFetch(`${API_BASE}/api/conversations/${conversationId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete conversation');
    return response.json();
  },

  // ── Settings ─────────────────────────────────────────────────────

  async getSettings() {
    const response = await authFetch(`${API_BASE}/api/settings`);
    if (!response.ok) throw new Error('Failed to get settings');
    return response.json();
  },

  async updateSettings(settings) {
    const response = await authFetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!response.ok) throw new Error('Failed to update settings');
    return response.json();
  },

  async getDefaultSettings() {
    const response = await authFetch(`${API_BASE}/api/settings/defaults`);
    if (!response.ok) throw new Error('Failed to get default settings');
    return response.json();
  },

  // ── API key testing ──────────────────────────────────────────────

  async testTavilyKey(apiKey) {
    const response = await authFetch(`${API_BASE}/api/settings/test-tavily`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) throw new Error('Failed to test API key');
    return response.json();
  },

  async testOpenRouterKey(apiKey) {
    const response = await authFetch(`${API_BASE}/api/settings/test-openrouter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) throw new Error('Failed to test API key');
    return response.json();
  },

  async testBraveKey(apiKey) {
    const response = await authFetch(`${API_BASE}/api/settings/test-brave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) throw new Error('Failed to test API key');
    return response.json();
  },

  async testSerperKey(apiKey) {
    const response = await authFetch(`${API_BASE}/api/settings/test-serper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) throw new Error('Failed to test API key');
    return response.json();
  },

  async testProviderKey(providerId, apiKey) {
    const response = await authFetch(`${API_BASE}/api/settings/test-provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: providerId, api_key: apiKey }),
    });
    if (!response.ok) throw new Error('Failed to test API key');
    return response.json();
  },

  async testOllamaConnection(baseUrl) {
    const response = await authFetch(`${API_BASE}/api/settings/test-ollama`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_url: baseUrl }),
    });
    if (!response.ok) throw new Error('Failed to test Ollama connection');
    return response.json();
  },

  async testCustomEndpoint(name, url, apiKey) {
    const response = await authFetch(`${API_BASE}/api/settings/test-custom-endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url, api_key: apiKey }),
    });
    if (!response.ok) throw new Error('Failed to test custom endpoint');
    return response.json();
  },

  // ── Models ───────────────────────────────────────────────────────

  async getCustomEndpointModels() {
    const response = await authFetch(`${API_BASE}/api/custom-endpoint/models`);
    if (!response.ok) throw new Error('Failed to get custom endpoint models');
    return response.json();
  },

  async getModels() {
    const response = await authFetch(`${API_BASE}/api/models`);
    if (!response.ok) throw new Error('Failed to get models');
    return response.json();
  },

  async getOllamaModels(baseUrl) {
    let url = `${API_BASE}/api/ollama/tags`;
    if (baseUrl) url += `?base_url=${encodeURIComponent(baseUrl)}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to get Ollama models');
    return response.json();
  },

  async getDirectModels() {
    const response = await authFetch(`${API_BASE}/api/models/direct`);
    if (!response.ok) throw new Error('Failed to get direct models');
    return response.json();
  },

  // ── Streaming ────────────────────────────────────────────────────

  async sendMessageStream(conversationId, options, onEvent, signal) {
    const { content, webSearch = false, executionMode = 'full' } = options;
    const authHeaders = await getAuthHeaders();
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream?_t=${Date.now()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ...authHeaders },
        body: JSON.stringify({ content, web_search: webSearch, execution_mode: executionMode }),
        signal,
        cache: 'no-store',
      },
    );
    if (!response.ok) throw new Error('Failed to send message');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
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

  // ── File uploads ─────────────────────────────────────────────────

  async uploadFile(conversationId, file) {
    const formData = new FormData();
    formData.append('file', file);
    const authHeaders = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/upload`, {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to upload file');
    }
    return response.json();
  },

  getFileUrl(conversationId, filename) {
    return `${API_BASE}/api/files/${conversationId}/${filename}`;
  },

  // ── Debate streaming ─────────────────────────────────────────────

  async sendDebateStream(conversationId, options, onEvent, signal) {
    const { content, webSearch = false, fileIds = [], mode, chatModel } = options;
    const authHeaders = await getAuthHeaders();
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/debate/stream?_t=${Date.now()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ...authHeaders },
        body: JSON.stringify({
          content,
          web_search: webSearch,
          file_ids: fileIds.length > 0 ? fileIds : undefined,
          mode: mode || undefined,
          chat_model: chatModel || undefined,
        }),
        signal,
        cache: 'no-store',
      },
    );
    if (!response.ok) throw new Error('Failed to start debate');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
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

  async sendInterjection(conversationId, content) {
    const response = await authFetch(`${API_BASE}/api/conversations/${conversationId}/interject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) throw new Error('Failed to send interjection');
    return response.json();
  },

  // ── Campaigns ────────────────────────────────────────────────────

  async createCampaign(name) {
    const response = await authFetch(`${API_BASE}/api/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) throw new Error('Failed to create campaign');
    return response.json();
  },

  async listCampaigns() {
    const response = await authFetch(`${API_BASE}/api/campaigns`);
    if (!response.ok) throw new Error('Failed to list campaigns');
    return response.json();
  },

  async getCampaign(campaignId) {
    const response = await authFetch(`${API_BASE}/api/campaigns/${campaignId}`);
    if (!response.ok) throw new Error('Failed to get campaign');
    return response.json();
  },

  async updateCampaign(campaignId, updates) {
    const response = await authFetch(`${API_BASE}/api/campaigns/${campaignId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update campaign');
    return response.json();
  },

  async deleteCampaign(campaignId) {
    const response = await authFetch(`${API_BASE}/api/campaigns/${campaignId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to delete campaign');
    return response.json();
  },

  async addStage(campaignId, name) {
    const response = await authFetch(`${API_BASE}/api/campaigns/${campaignId}/stages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) throw new Error('Failed to add stage');
    return response.json();
  },

  async reorderStages(campaignId, stageIds) {
    const response = await authFetch(`${API_BASE}/api/campaigns/${campaignId}/stages/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage_ids: stageIds }),
    });
    if (!response.ok) throw new Error('Failed to reorder stages');
    return response.json();
  },

  async updateStage(campaignId, stageId, updates) {
    const response = await authFetch(`${API_BASE}/api/campaigns/${campaignId}/stages/${stageId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update stage');
    return response.json();
  },

  async deleteStage(campaignId, stageId) {
    const response = await authFetch(`${API_BASE}/api/campaigns/${campaignId}/stages/${stageId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete stage');
    return response.json();
  },

  async addStageConversation(campaignId, stageId) {
    const response = await authFetch(`${API_BASE}/api/campaigns/${campaignId}/stages/${stageId}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error('Failed to add conversation to stage');
    return response.json();
  },

  // ── Campaign Sources ─────────────────────────────────────────────

  async uploadCampaignSource(campaignId, file) {
    const formData = new FormData();
    formData.append('file', file);
    const authHeaders = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/api/campaigns/${campaignId}/sources`, {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to upload source');
    }
    return response.json();
  },

  async createTextSource(campaignId, name, content) {
    const response = await authFetch(`${API_BASE}/api/campaigns/${campaignId}/sources/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to create text source');
    }
    return response.json();
  },

  async listCampaignSources(campaignId) {
    const response = await authFetch(`${API_BASE}/api/campaigns/${campaignId}/sources`);
    if (!response.ok) throw new Error('Failed to list sources');
    return response.json();
  },

  async renameCampaignSource(campaignId, sourceId, name) {
    const response = await authFetch(`${API_BASE}/api/campaigns/${campaignId}/sources/${sourceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) throw new Error('Failed to rename source');
    return response.json();
  },

  async deleteCampaignSource(campaignId, sourceId) {
    const response = await authFetch(`${API_BASE}/api/campaigns/${campaignId}/sources/${sourceId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete source');
    return response.json();
  },

  getCampaignSourceUrl(campaignId, sourceId) {
    return `${API_BASE}/api/campaigns/${campaignId}/sources/${sourceId}/file`;
  },

  // ── Debate Config ────────────────────────────────────────────────

  async getStageDebateConfig(campaignId, stageId) {
    const response = await authFetch(`${API_BASE}/api/campaigns/${campaignId}/stages/${stageId}/debate-config`);
    if (!response.ok) throw new Error('Failed to get stage debate config');
    return response.json();
  },

  async updateStageDebateConfig(campaignId, stageId, debateModels, debateRoles) {
    const response = await authFetch(`${API_BASE}/api/campaigns/${campaignId}/stages/${stageId}/debate-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ debate_models: debateModels, debate_roles: debateRoles }),
    });
    if (!response.ok) throw new Error('Failed to update stage debate config');
    return response.json();
  },

  async clearStageDebateConfig(campaignId, stageId) {
    const response = await authFetch(`${API_BASE}/api/campaigns/${campaignId}/stages/${stageId}/debate-config`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to clear stage debate config');
    return response.json();
  },

  async getConversationDebateConfig(conversationId) {
    const response = await authFetch(`${API_BASE}/api/conversations/${conversationId}/debate-config`);
    if (!response.ok) throw new Error('Failed to get conversation debate config');
    return response.json();
  },

  async updateConversationDebateConfig(conversationId, debateModels, debateRoles) {
    const response = await authFetch(`${API_BASE}/api/conversations/${conversationId}/debate-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ debate_models: debateModels, debate_roles: debateRoles }),
    });
    if (!response.ok) throw new Error('Failed to update conversation debate config');
    return response.json();
  },

  async clearConversationDebateConfig(conversationId) {
    const response = await authFetch(`${API_BASE}/api/conversations/${conversationId}/debate-config`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to clear conversation debate config');
    return response.json();
  },

  // ── Publish / Team Feed ──────────────────────────────────────────

  async publishConversation(conversationId, title, description = '') {
    const response = await authFetch(`${API_BASE}/api/conversations/${conversationId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description }),
    });
    if (!response.ok) throw new Error('Failed to publish conversation');
    return response.json();
  },

  async getTeamFeed() {
    const response = await authFetch(`${API_BASE}/api/team-feed`);
    if (!response.ok) throw new Error('Failed to get team feed');
    return response.json();
  },

  async getPublishedItem(itemId) {
    const response = await authFetch(`${API_BASE}/api/team-feed/${itemId}`);
    if (!response.ok) throw new Error('Failed to get published item');
    return response.json();
  },

  async unpublishItem(itemId) {
    const response = await authFetch(`${API_BASE}/api/team-feed/${itemId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to unpublish');
    return response.json();
  },

  async dismissItem(itemId) {
    const response = await authFetch(`${API_BASE}/api/team-feed/${itemId}/dismiss`, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to dismiss');
    return response.json();
  },

  // ── Comments ─────────────────────────────────────────────────────

  async getComments(itemId) {
    const response = await authFetch(`${API_BASE}/api/team-feed/${itemId}/comments`);
    if (!response.ok) throw new Error('Failed to get comments');
    return response.json();
  },

  async addComment(itemId, text) {
    const response = await authFetch(`${API_BASE}/api/team-feed/${itemId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error('Failed to add comment');
    return response.json();
  },

  async deleteComment(itemId, commentId) {
    const response = await authFetch(`${API_BASE}/api/team-feed/${itemId}/comments/${commentId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete comment');
    return response.json();
  },
};
