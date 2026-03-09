import { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import Settings from './components/Settings';
import CampaignBar from './components/CampaignBar';
import CampaignStageView from './components/CampaignStageView';
import StageManager from './components/StageManager';
import { api } from './api';
import './App.css';
import './components/StageCopyButtons.css';

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDebateActive, setIsDebateActive] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState('llm_keys');
  const [ollamaStatus, setOllamaStatus] = useState({
    connected: false,
    lastConnected: null,
    testing: false
  });
  const [debateConfigured, setDebateConfigured] = useState(true);
  const [debateModels, setDebateModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState(null);
  const [searchProvider, setSearchProvider] = useState('duckduckgo');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const abortControllerRef = useRef(null);
  const requestIdRef = useRef(0);

  const [campaigns, setCampaigns] = useState([]);
  const [currentCampaignId, setCurrentCampaignId] = useState(null);
  const [currentStageId, setCurrentStageId] = useState(null);
  const [showStageOverview, setShowStageOverview] = useState(false);
  const [managingCampaignId, setManagingCampaignId] = useState(null);

  useEffect(() => {
    checkInitialSetup();
  }, []);

  const checkInitialSetup = async () => {
    try {
      const settings = await api.getSettings();
      setSearchProvider(settings.search_provider || 'duckduckgo');

      const hasApiKey = settings.openrouter_api_key_set ||
        settings.groq_api_key_set ||
        settings.openai_api_key_set ||
        settings.anthropic_api_key_set ||
        settings.google_api_key_set ||
        settings.mistral_api_key_set ||
        settings.deepseek_api_key_set;

      const ollamaUrl = settings.ollama_base_url || 'http://localhost:11434';
      setOllamaStatus(prev => ({ ...prev, testing: true }));

      let isOllamaConnected = false;
      try {
        const result = await api.testOllamaConnection(ollamaUrl);
        isOllamaConnected = result.success;
        setOllamaStatus({
          connected: result.success,
          lastConnected: result.success ? new Date().toLocaleString() : null,
          testing: false
        });
      } catch {
        setOllamaStatus({ connected: false, lastConnected: null, testing: false });
      }

      const models = settings.debate_models || [];
      const chairman = settings.chairman_model || '';
      setDebateModels(models);
      setChairmanModel(chairman);

      const hasDebaters = models.some(m => m && m.trim() !== '');
      setDebateConfigured(hasDebaters);

      if (!hasApiKey && !isOllamaConnected) {
        setShowSettings(true);
      }
    } catch (error) {
      console.error('Failed to check initial setup:', error);
    }
  };

  const handleSettingsClose = async () => {
    setShowSettings(false);
    try {
      const settings = await api.getSettings();
      const models = settings.debate_models || [];
      const chairman = settings.chairman_model || '';
      setDebateModels(models);
      setChairmanModel(chairman);
      setSearchProvider(settings.search_provider || 'duckduckgo');
      const hasDebaters = models.some(m => m && m.trim() !== '');
      setDebateConfigured(hasDebaters);
    } catch (error) {
      console.error('Error after closing settings:', error);
    }
  };

  const handleOpenSettings = (section = 'debate') => {
    setSettingsInitialSection(section || 'debate');
    setShowSettings(true);
  };

  useEffect(() => {
    loadConversations();
    loadCampaigns();
  }, []);

  const testOllamaConnection = async (customUrl = null) => {
    try {
      setOllamaStatus(prev => ({ ...prev, testing: true }));
      let urlToTest = customUrl;
      if (!urlToTest) {
        const settings = await api.getSettings();
        urlToTest = settings.ollama_base_url;
      }
      if (!urlToTest) {
        setOllamaStatus({ connected: false, lastConnected: null, testing: false });
        return;
      }
      const result = await api.testOllamaConnection(urlToTest);
      setOllamaStatus({
        connected: result.success,
        lastConnected: result.success ? new Date().toLocaleString() : null,
        testing: false
      });
    } catch {
      setOllamaStatus({ connected: false, lastConnected: null, testing: false });
    }
  };

  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

  const loadConversations = async (retryCount = 0) => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
      if (retryCount < 3) {
        setTimeout(() => loadConversations(retryCount + 1), (retryCount + 1) * 1000);
      }
    }
  };

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      setCurrentConversation(conv);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const loadCampaigns = async () => {
    try {
      const camps = await api.listCampaigns();
      setCampaigns(camps);
    } catch (error) {
      console.error('Failed to load campaigns:', error);
    }
  };

  const handleNewConversation = async () => {
    setCurrentCampaignId(null);
    setCurrentStageId(null);
    setShowStageOverview(false);
    const existingEmpty = conversations.find(conv => !conv.title && conv.message_count === 0);
    if (existingEmpty) {
      setCurrentConversationId(existingEmpty.id);
      return;
    }
    try {
      const newConv = await api.createConversation();
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    let foundCampaign = null;
    let foundStage = null;
    for (const camp of campaigns) {
      for (const stage of (camp.stages || [])) {
        if ((stage.conversation_ids || []).includes(id)) {
          foundCampaign = camp.id;
          foundStage = stage.id;
          break;
        }
      }
      if (foundCampaign) break;
    }
    setCurrentCampaignId(foundCampaign);
    setCurrentStageId(foundStage);
    setCurrentConversationId(id);
    setShowStageOverview(false);
  };

  const handleDeleteConversation = async (id) => {
    try {
      await api.deleteConversation(id);
      setConversations(conversations.filter(c => c.id !== id));
      if (id === currentConversationId) {
        setCurrentConversationId(null);
        setCurrentConversation(null);
      }
      await loadCampaigns();
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const handleAbort = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
      setIsDebateActive(false);
    }
  };

  const handleInterject = async (content) => {
    if (!currentConversationId) return;
    try {
      await api.sendInterjection(currentConversationId, content);
    } catch (error) {
      console.error('Failed to send interjection:', error);
    }
  };

  // ── Campaign handlers ───────────────────────────────────────────────

  const handleNewCampaign = async (name) => {
    try {
      const campaign = await api.createCampaign(name);
      setCampaigns(prev => [campaign, ...prev]);
      setManagingCampaignId(campaign.id);
    } catch (error) {
      console.error('Failed to create campaign:', error);
    }
  };

  const handleDeleteCampaign = async (campaignId) => {
    try {
      await api.deleteCampaign(campaignId);
      setCampaigns(prev => prev.filter(c => c.id !== campaignId));
      if (campaignId === currentCampaignId) {
        setCurrentCampaignId(null);
        setCurrentStageId(null);
        setCurrentConversationId(null);
        setCurrentConversation(null);
      }
      loadConversations();
    } catch (error) {
      console.error('Failed to delete campaign:', error);
    }
  };

  const handleSelectStage = async (campaignId, stage, conversationId) => {
    if (conversationId) {
      setCurrentCampaignId(campaignId);
      setCurrentStageId(stage.id);
      setCurrentConversationId(conversationId);
      setShowStageOverview(false);
      setSidebarOpen(false);
      setManagingCampaignId(null);
      await loadCampaigns();
      loadConversations();
    } else {
      setCurrentCampaignId(campaignId);
      setCurrentStageId(stage.id);
      setCurrentConversationId(null);
      setCurrentConversation(null);
      setShowStageOverview(true);
      setSidebarOpen(false);
      setManagingCampaignId(null);
      await loadCampaigns();
      loadConversations();
    }
  };

  const handleSelectStageChat = (convId) => {
    setCurrentConversationId(convId);
    setShowStageOverview(false);
  };

  const handleNewStageConversation = async (campaignId, stageId) => {
    try {
      const result = await api.addStageConversation(campaignId, stageId);
      await loadCampaigns();
      await loadConversations();
      setCurrentCampaignId(campaignId);
      setCurrentStageId(stageId);
      setCurrentConversationId(result.conversation_id);
      setShowStageOverview(false);
      setSidebarOpen(false);
    } catch (error) {
      console.error('Failed to create stage conversation:', error);
    }
  };

  const handleManageCampaign = (campaignId) => {
    setManagingCampaignId(campaignId);
  };

  const handleRenameCampaign = async (campaignId, newName) => {
    try {
      await api.updateCampaign(campaignId, { name: newName });
      setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, name: newName } : c));
    } catch (error) {
      console.error('Failed to rename campaign:', error);
    }
  };

  const handleDuplicateCampaign = async (campaignId) => {
    try {
      const source = campaigns.find(c => c.id === campaignId);
      if (!source) return;
      const newCampaign = await api.createCampaign(source.name + ' (copy)');
      setCampaigns(prev => [newCampaign, ...prev]);
    } catch (error) {
      console.error('Failed to duplicate campaign:', error);
    }
  };

  const handleRenameStage = async (campaignId, stageId, newName) => {
    try {
      await api.updateStage(campaignId, stageId, { name: newName });
      await loadCampaigns();
    } catch (error) {
      console.error('Failed to rename stage:', error);
    }
  };

  const handleDeleteStage = async (campaignId, stageId) => {
    try {
      await api.deleteStage(campaignId, stageId);
      await loadCampaigns();
    } catch (error) {
      console.error('Failed to delete stage:', error);
    }
  };

  const handleDuplicateStage = async (campaignId, stageId) => {
    try {
      const campaign = campaigns.find(c => c.id === campaignId);
      const stage = campaign?.stages?.find(s => s.id === stageId);
      if (!stage) return;
      await api.addStage(campaignId, stage.name + ' (copy)');
      await loadCampaigns();
    } catch (error) {
      console.error('Failed to duplicate stage:', error);
    }
  };

  const handleRenameConversation = async (convId, newName) => {
    try {
      await api.renameConversation(convId, newName);
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, title: newName } : c));
    } catch (error) {
      console.error('Failed to rename conversation:', error);
    }
  };

  const handleDuplicateConversation = async (convId) => {
    console.warn('Duplicate conversation: backend support pending');
  };

  const handleStageManagerClose = () => {
    setManagingCampaignId(null);
    loadCampaigns();
  };

  const currentCampaign = campaigns.find(c => c.id === currentCampaignId);
  const currentStage = currentCampaign?.stages?.find(s => s.id === currentStageId);

  const handleSendMessage = async (content, webSearch, files = null, mode = null, chatModel = null) => {
    if (!currentConversationId) return;

    const currentRequestId = ++requestIdRef.current;
    abortControllerRef.current = new AbortController();

    setIsLoading(true);
    setIsDebateActive(true);

    try {
      let fileIds = [];
      let uploadedMetas = [];
      if (files && files.length > 0) {
        for (const file of files) {
          try {
            const meta = await api.uploadFile(currentConversationId, file);
            fileIds.push(meta.id);
            uploadedMetas.push(meta);
          } catch (err) {
            console.error('File upload failed:', err);
          }
        }
      }

      const userMessage = {
        role: 'user',
        content,
        files: uploadedMetas.length > 0 ? uploadedMetas : undefined,
      };
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      const isChat = mode === 'chat';
      const assistantMessage = {
        role: 'assistant',
        mode: isChat ? 'chat' : 'debate',
        ...(isChat
          ? { chat_response: null }
          : { debate_entries: [], summary: null }),
        metadata: null,
        loading: {
          active: true,
          search: false,
          currentModel: null,
          currentRole: null,
          currentRound: null,
          convergence: false,
          summary: false,
        },
      };

      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      await api.sendDebateStream(
        currentConversationId,
        { content, webSearch, fileIds, mode, chatModel },
        (eventType, event) => {
          switch (eventType) {
            case 'search_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const last = { ...messages[messages.length - 1] };
                last.loading = { ...last.loading, search: true };
                messages[messages.length - 1] = last;
                return { ...prev, messages };
              });
              break;

            case 'search_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const last = { ...messages[messages.length - 1] };
                last.loading = { ...last.loading, search: false };
                last.metadata = {
                  ...last.metadata,
                  search_query: event.data.search_query,
                  search_context: event.data.search_context,
                };
                messages[messages.length - 1] = last;
                return { ...prev, messages };
              });
              break;

            case 'debate_start':
            case 'chat_start':
              break;

            case 'round_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const last = { ...messages[messages.length - 1] };
                last.loading = { ...last.loading, currentRound: event.data.round };
                messages[messages.length - 1] = last;
                return { ...prev, messages };
              });
              break;

            case 'turn_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const last = { ...messages[messages.length - 1] };
                last.loading = {
                  ...last.loading,
                  active: true,
                  currentModel: event.data.model,
                  currentRole: event.data.role_name,
                };
                messages[messages.length - 1] = last;
                return { ...prev, messages };
              });
              break;

            case 'turn_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const last = { ...messages[messages.length - 1] };
                last.debate_entries = [...(last.debate_entries || []), event.data];
                last.loading = { ...last.loading, currentModel: null, currentRole: null };
                messages[messages.length - 1] = last;
                return { ...prev, messages };
              });
              break;

            case 'chat_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const last = { ...messages[messages.length - 1] };
                last.mode = 'chat';
                last.chat_response = event.data;
                last.loading = { ...last.loading, active: false };
                messages[messages.length - 1] = last;
                return { ...prev, messages };
              });
              setIsLoading(false);
              setIsDebateActive(false);
              break;

            case 'interjection_applied':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const last = { ...messages[messages.length - 1] };
                last.debate_entries = [
                  ...(last.debate_entries || []),
                  { type: 'interjection', content: event.data.content }
                ];
                messages[messages.length - 1] = last;
                return { ...prev, messages };
              });
              break;

            case 'convergence_check':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const last = { ...messages[messages.length - 1] };
                last.loading = { ...last.loading, convergence: false };
                messages[messages.length - 1] = last;
                return { ...prev, messages };
              });
              break;

            case 'summary_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const last = { ...messages[messages.length - 1] };
                last.loading = { ...last.loading, active: true, summary: true, currentModel: null };
                messages[messages.length - 1] = last;
                return { ...prev, messages };
              });
              setIsDebateActive(false);
              break;

            case 'summary_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const last = { ...messages[messages.length - 1] };
                last.summary = event.data;
                last.loading = { ...last.loading, active: false, summary: false };
                messages[messages.length - 1] = last;
                return { ...prev, messages };
              });
              setIsLoading(false);
              if (currentCampaignId) {
                loadCampaigns();
              }
              break;

            case 'title_complete':
              loadConversations();
              break;

            case 'complete':
              loadConversations();
              setIsLoading(false);
              setIsDebateActive(false);
              break;

            case 'error':
              console.error('Stream error:', event.message);
              setIsLoading(false);
              setIsDebateActive(false);
              break;
          }
        },
        abortControllerRef.current?.signal
      );
    } catch (error) {
      if (error.name === 'AbortError') {
        setCurrentConversation((prev) => {
          if (!prev || prev.messages.length < 2) return prev;
          const messages = [...prev.messages];
          const last = messages[messages.length - 1];
          if (last.role === 'assistant') {
            messages[messages.length - 1] = {
              ...last,
              aborted: true,
              loading: { active: false, search: false, currentModel: null, currentRole: null, convergence: false, summary: false },
            };
          }
          return { ...prev, messages };
        });
        return;
      }
      console.error('Failed to send message:', error);
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
      setIsLoading(false);
      setIsDebateActive(false);
    } finally {
      if (requestIdRef.current === currentRequestId) {
        abortControllerRef.current = null;
      }
      loadConversations();
    }
  };

  const handleMobileSelectConversation = (id) => {
    handleSelectConversation(id);
    setSidebarOpen(false);
  };

  const handleMobileNewConversation = async () => {
    await handleNewConversation();
    setSidebarOpen(false);
  };

  const handleMobileOpenSettings = () => {
    setShowSettings(true);
    setSidebarOpen(false);
  };

  return (
    <div className="app">
      <button
        className="mobile-menu-btn"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open menu"
      >
        <span className="hamburger-icon"></span>
      </button>

      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleMobileSelectConversation}
        onNewConversation={handleMobileNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onOpenSettings={handleMobileOpenSettings}
        isLoading={isLoading}
        onAbort={handleAbort}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        campaigns={campaigns}
        currentCampaignId={currentCampaignId}
        onNewCampaign={handleNewCampaign}
        onSelectStage={handleSelectStage}
        onDeleteCampaign={handleDeleteCampaign}
        onManageCampaign={handleManageCampaign}
        onNewStageConversation={handleNewStageConversation}
        onRenameCampaign={handleRenameCampaign}
        onDuplicateCampaign={handleDuplicateCampaign}
        onRenameStage={handleRenameStage}
        onDeleteStage={handleDeleteStage}
        onDuplicateStage={handleDuplicateStage}
        onRenameConversation={handleRenameConversation}
        onDuplicateConversation={handleDuplicateConversation}
        onGoHome={() => {
          setCurrentCampaignId(null);
          setCurrentStageId(null);
          setShowStageOverview(false);
          handleNewConversation();
          setSidebarOpen(false);
        }}
      />

      <div className="main-content">
        {showStageOverview && currentCampaign && currentStage ? (
          <CampaignStageView
            campaign={currentCampaign}
            stage={currentStage}
            conversations={conversations}
            onSelectChat={handleSelectStageChat}
            onNewChat={() => handleNewStageConversation(currentCampaignId, currentStageId)}
            onRenameChat={handleRenameConversation}
            onDeleteChat={handleDeleteConversation}
            onBack={() => {
              setShowStageOverview(false);
              setCurrentCampaignId(null);
              setCurrentStageId(null);
            }}
          />
        ) : (
          <>
            {currentCampaign && currentStage && (
              <CampaignBar
                campaign={currentCampaign}
                stage={currentStage}
                currentConversationId={currentConversationId}
                onManage={() => handleManageCampaign(currentCampaign.id)}
              />
            )}
            <ChatInterface
              conversation={currentConversation}
              onSendMessage={handleSendMessage}
              onAbort={handleAbort}
              onInterject={handleInterject}
              isLoading={isLoading}
              isDebateActive={isDebateActive}
              debateConfigured={debateConfigured}
              debateModels={debateModels}
              chairmanModel={chairmanModel}
              searchProvider={searchProvider}
              onOpenSettings={handleOpenSettings}
            />
          </>
        )}
      </div>

      {managingCampaignId && (
        <StageManager
          campaignId={managingCampaignId}
          onClose={handleStageManagerClose}
          onSelectStage={handleSelectStage}
          currentConversationId={currentConversationId}
        />
      )}

      {showSettings && (
        <Settings
          onClose={handleSettingsClose}
          ollamaStatus={ollamaStatus}
          onRefreshOllama={testOllamaConnection}
          initialSection={settingsInitialSection}
        />
      )}
    </div>
  );
}

export default App;
