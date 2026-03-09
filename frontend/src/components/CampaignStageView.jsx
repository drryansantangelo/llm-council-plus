import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import StageExpertConfig from './StageExpertConfig';
import './CampaignStageView.css';

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatAbsoluteDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const EllipsisIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <circle cx="3" cy="7" r="1.2" />
    <circle cx="7" cy="7" r="1.2" />
    <circle cx="11" cy="7" r="1.2" />
  </svg>
);

export default function CampaignStageView({
  campaign,
  stage,
  conversations,
  onSelectChat,
  onNewChat,
  onRenameChat,
  onDeleteChat,
  onBack,
}) {
  const [activeTab, setActiveTab] = useState('chats');
  const [sources, setSources] = useState([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [showTextModal, setShowTextModal] = useState(false);
  const [textSourceName, setTextSourceName] = useState('');
  const [textSourceContent, setTextSourceContent] = useState('');
  const [savingText, setSavingText] = useState(false);
  const [showScreenshotModal, setShowScreenshotModal] = useState(false);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [screenshotName, setScreenshotName] = useState('');
  const [savingScreenshot, setSavingScreenshot] = useState(false);
  const fileInputRef = useRef(null);
  const textAreaRef = useRef(null);
  const screenshotNameRef = useRef(null);

  const [chatMenu, setChatMenu] = useState(null);
  const [renamingChatId, setRenamingChatId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const chatMenuRef = useRef(null);
  const renameInputRef = useRef(null);

  const [sourceMenu, setSourceMenu] = useState(null);
  const [renamingSourceId, setRenamingSourceId] = useState(null);
  const [sourceRenameValue, setSourceRenameValue] = useState('');
  const [confirmDeleteSourceId, setConfirmDeleteSourceId] = useState(null);
  const sourceMenuRef = useRef(null);
  const sourceRenameInputRef = useRef(null);

  // Expert config state
  const [stageDebateConfig, setStageDebateConfig] = useState(null);
  const [loadingExpertConfig, setLoadingExpertConfig] = useState(false);
  const [savingExpertConfig, setSavingExpertConfig] = useState(false);
  const [chatDebateConfigs, setChatDebateConfigs] = useState({});
  const [configuringChatId, setConfiguringChatId] = useState(null);
  const [globalDefaults, setGlobalDefaults] = useState(null);
  const [publishDialog, setPublishDialog] = useState(null);
  const [publishLoading, setPublishLoading] = useState(false);

  const stageConversations = React.useMemo(() => {
    if (!stage) return [];
    const convIds = stage.conversation_ids || [];
    return convIds
      .map(id => conversations.find(c => c.id === id))
      .filter(Boolean);
  }, [stage, conversations]);

  const loadSources = useCallback(async () => {
    if (!campaign?.id) return;
    setLoadingSources(true);
    try {
      const data = await api.listCampaignSources(campaign.id);
      setSources(data);
    } catch (err) {
      console.error('Failed to load sources:', err);
    } finally {
      setLoadingSources(false);
    }
  }, [campaign?.id]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  // ── Expert Config ──────────────────────────────────────────────────

  const loadStageExpertConfig = useCallback(async () => {
    if (!campaign?.id || !stage?.id) return;
    setLoadingExpertConfig(true);
    try {
      const data = await api.getStageDebateConfig(campaign.id, stage.id);
      setStageDebateConfig(data.debate_config || null);
    } catch (err) {
      console.error('Failed to load stage debate config:', err);
    } finally {
      setLoadingExpertConfig(false);
    }
  }, [campaign?.id, stage?.id]);

  const loadChatDebateConfigs = useCallback(async () => {
    if (!stage) return;
    const convIds = stage.conversation_ids || [];
    const configs = {};
    await Promise.all(
      convIds.map(async (convId) => {
        try {
          const data = await api.getConversationDebateConfig(convId);
          if (data.debate_config) {
            configs[convId] = data.debate_config;
          }
        } catch {
          // ignore
        }
      })
    );
    setChatDebateConfigs(configs);
  }, [stage]);

  useEffect(() => {
    loadStageExpertConfig();
    loadChatDebateConfigs();
  }, [loadStageExpertConfig, loadChatDebateConfigs]);

  useEffect(() => {
    api.getSettings().then(settings => {
      if (settings.debate_models || settings.debate_roles) {
        setGlobalDefaults({
          debate_models: settings.debate_models || ['', ''],
          debate_roles: settings.debate_roles || ['', ''],
        });
      }
    }).catch(() => {});
  }, []);

  const inheritedConfig = React.useMemo(() => {
    if (stageDebateConfig) return null;

    const stages = campaign?.stages || [];
    const currentPos = stage?.position;
    if (currentPos == null) return null;

    const preceding = stages
      .filter(s => s.position < currentPos && s.debate_config)
      .sort((a, b) => b.position - a.position);

    if (preceding.length > 0) {
      const prev = preceding[0];
      return {
        debate_models: prev.debate_config.debate_models,
        debate_roles: prev.debate_config.debate_roles,
        source: 'stage',
        sourceName: prev.name,
      };
    }

    if (globalDefaults) {
      const hasModels = globalDefaults.debate_models?.some(m => m);
      const hasRoles = globalDefaults.debate_roles?.some(r => r);
      if (hasModels || hasRoles) {
        return {
          debate_models: globalDefaults.debate_models,
          debate_roles: globalDefaults.debate_roles,
          source: 'global',
          sourceName: null,
        };
      }
    }

    return null;
  }, [stageDebateConfig, campaign?.stages, stage?.position, globalDefaults]);

  const handleSaveStageConfig = async (models, roles) => {
    if (!campaign?.id || !stage?.id) return;
    setSavingExpertConfig(true);
    try {
      await api.updateStageDebateConfig(campaign.id, stage.id, models, roles);
      setStageDebateConfig({ debate_models: models, debate_roles: roles });
    } catch (err) {
      console.error('Failed to save stage debate config:', err);
    } finally {
      setSavingExpertConfig(false);
    }
  };

  const handleClearStageConfig = async () => {
    if (!campaign?.id || !stage?.id) return;
    setSavingExpertConfig(true);
    try {
      await api.clearStageDebateConfig(campaign.id, stage.id);
      setStageDebateConfig(null);
    } catch (err) {
      console.error('Failed to clear stage debate config:', err);
    } finally {
      setSavingExpertConfig(false);
    }
  };

  const handleSaveChatConfig = async (convId, models, roles) => {
    setSavingExpertConfig(true);
    try {
      await api.updateConversationDebateConfig(convId, models, roles);
      setChatDebateConfigs(prev => ({ ...prev, [convId]: { debate_models: models, debate_roles: roles } }));
    } catch (err) {
      console.error('Failed to save chat debate config:', err);
    } finally {
      setSavingExpertConfig(false);
    }
  };

  const handleClearChatConfig = async (convId) => {
    setSavingExpertConfig(true);
    try {
      await api.clearConversationDebateConfig(convId);
      setChatDebateConfigs(prev => {
        const next = { ...prev };
        delete next[convId];
        return next;
      });
      setConfiguringChatId(null);
    } catch (err) {
      console.error('Failed to clear chat debate config:', err);
    } finally {
      setSavingExpertConfig(false);
    }
  };

  // ── Chat context menu ─────────────────────────────────────────────

  useEffect(() => {
    if (!chatMenu) return;
    const handleClick = (e) => {
      if (chatMenuRef.current && !chatMenuRef.current.contains(e.target)) {
        setChatMenu(null);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setChatMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [chatMenu]);

  const openChatMenu = (e, convId) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setChatMenu({ id: convId, x: rect.left, y: rect.bottom + 4 });
  };

  const handleChatMenuAction = (action) => {
    if (!chatMenu) return;
    const convId = chatMenu.id;
    setChatMenu(null);

    if (action === 'rename') {
      const conv = conversations.find(c => c.id === convId);
      setRenameValue(conv?.title || '');
      setRenamingChatId(convId);
    } else if (action === 'delete') {
      setConfirmDeleteId(convId);
    } else if (action === 'configure_experts') {
      setConfiguringChatId(convId === configuringChatId ? null : convId);
    } else if (action === 'publish') {
      const conv = conversations.find(c => c.id === convId);
      setPublishDialog({ conversationId: convId, title: conv?.title || 'Untitled', description: '' });
    }
  };

  // ── Rename ────────────────────────────────────────────────────────

  useEffect(() => {
    if (renamingChatId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingChatId]);

  const commitRename = () => {
    if (renamingChatId && renameValue.trim()) {
      onRenameChat?.(renamingChatId, renameValue.trim());
    }
    setRenamingChatId(null);
  };

  const cancelRename = () => setRenamingChatId(null);

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
  };

  // ── Delete confirmation ───────────────────────────────────────────

  const confirmDelete = () => {
    if (confirmDeleteId) {
      onDeleteChat?.(confirmDeleteId);
      setConfirmDeleteId(null);
    }
  };

  // ── Source context menu ──────────────────────────────────────────

  useEffect(() => {
    if (!sourceMenu) return;
    const handleClick = (e) => {
      if (sourceMenuRef.current && !sourceMenuRef.current.contains(e.target)) {
        setSourceMenu(null);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setSourceMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [sourceMenu]);

  const openSourceMenu = (e, sourceId) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setSourceMenu({ id: sourceId, x: rect.left, y: rect.bottom + 4 });
  };

  const handleSourceMenuAction = (action) => {
    if (!sourceMenu) return;
    const srcId = sourceMenu.id;
    setSourceMenu(null);

    if (action === 'open') {
      const url = api.getCampaignSourceUrl(campaign.id, srcId);
      window.open(url, '_blank');
    } else if (action === 'rename') {
      const src = sources.find(s => s.id === srcId);
      setSourceRenameValue(src?.original_name || '');
      setRenamingSourceId(srcId);
    } else if (action === 'delete') {
      setConfirmDeleteSourceId(srcId);
    }
  };

  useEffect(() => {
    if (renamingSourceId && sourceRenameInputRef.current) {
      sourceRenameInputRef.current.focus();
      sourceRenameInputRef.current.select();
    }
  }, [renamingSourceId]);

  const commitSourceRename = async () => {
    if (renamingSourceId && sourceRenameValue.trim() && campaign?.id) {
      try {
        await api.renameCampaignSource(campaign.id, renamingSourceId, sourceRenameValue.trim());
        setSources(prev => prev.map(s =>
          s.id === renamingSourceId ? { ...s, original_name: sourceRenameValue.trim() } : s
        ));
      } catch (err) {
        console.error('Failed to rename source:', err);
      }
    }
    setRenamingSourceId(null);
  };

  const cancelSourceRename = () => setRenamingSourceId(null);

  const handleSourceRenameKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitSourceRename(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelSourceRename(); }
  };

  const confirmDeleteSource = () => {
    if (confirmDeleteSourceId) {
      handleDeleteSource(confirmDeleteSourceId);
      setConfirmDeleteSourceId(null);
    }
  };

  // ── Sources ───────────────────────────────────────────────────────

  const handleUpload = async (files) => {
    if (!files?.length) return;
    if (!campaign?.id) {
      setUploadError('No campaign selected. Please select a campaign first.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    const failed = [];
    try {
      for (const file of files) {
        try {
          await api.uploadCampaignSource(campaign.id, file);
        } catch (err) {
          failed.push(`${file.name}: ${err.message}`);
        }
      }
      await loadSources();
      if (failed.length) {
        setUploadError(`Failed to upload:\n${failed.join('\n')}`);
      }
    } catch (err) {
      setUploadError(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteSource = async (sourceId) => {
    if (!campaign?.id) return;
    try {
      await api.deleteCampaignSource(campaign.id, sourceId);
      setSources(prev => prev.filter(s => s.id !== sourceId));
    } catch (err) {
      console.error('Failed to delete source:', err);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) {
      handleUpload(Array.from(e.dataTransfer.files));
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragActive(false);
  };

  const openTextModal = () => {
    setTextSourceName('');
    setTextSourceContent('');
    setShowTextModal(true);
    setTimeout(() => textAreaRef.current?.focus(), 50);
  };

  const handleSaveTextSource = async () => {
    if (!textSourceContent.trim() || !campaign?.id) return;
    setSavingText(true);
    setUploadError(null);
    try {
      await api.createTextSource(campaign.id, textSourceName, textSourceContent);
      await loadSources();
      setShowTextModal(false);
    } catch (err) {
      setUploadError(`Failed to save text: ${err.message}`);
    } finally {
      setSavingText(false);
    }
  };

  const loadImageDimensions = useCallback((url, blob, type) => {
    const img = new Image();
    img.onload = () => {
      setScreenshotPreview({ blob, url, type, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = url;
    setScreenshotPreview({ blob, url, type, width: null, height: null });
    setScreenshotName('');
    setShowScreenshotModal(true);
    setTimeout(() => screenshotNameRef.current?.focus(), 50);
  }, []);

  const handlePasteScreenshot = useCallback(async (e) => {
    if (activeTab !== 'sources') return;
    const items = e?.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        loadImageDimensions(url, blob, blob.type);
        return;
      }
    }
  }, [activeTab, loadImageDimensions]);

  useEffect(() => {
    document.addEventListener('paste', handlePasteScreenshot);
    return () => document.removeEventListener('paste', handlePasteScreenshot);
  }, [handlePasteScreenshot]);

  const handlePasteFromClipboard = async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const url = URL.createObjectURL(blob);
          loadImageDimensions(url, blob, imageType);
          return;
        }
      }
      setUploadError('No image found in clipboard. Copy a screenshot first (e.g. Win+Shift+S).');
    } catch (err) {
      setUploadError('Could not read clipboard. Try pasting with Ctrl+V instead.');
    }
  };

  const handleSaveScreenshot = async () => {
    if (!screenshotPreview || !campaign?.id) return;
    setSavingScreenshot(true);
    setUploadError(null);
    try {
      const ext = screenshotPreview.type === 'image/jpeg' ? '.jpg' : '.png';
      const name = (screenshotName.trim() || 'Screenshot') + ext;
      const file = new File([screenshotPreview.blob], name, { type: screenshotPreview.type });
      await api.uploadCampaignSource(campaign.id, file);
      await loadSources();
      closeScreenshotModal();
    } catch (err) {
      setUploadError(`Failed to save screenshot: ${err.message}`);
    } finally {
      setSavingScreenshot(false);
    }
  };

  const closeScreenshotModal = () => {
    if (screenshotPreview?.url) {
      URL.revokeObjectURL(screenshotPreview.url);
    }
    setShowScreenshotModal(false);
    setScreenshotPreview(null);
    setScreenshotName('');
  };

  if (!campaign || !stage) return null;

  return (
    <div className="stage-view">
      <div className="stage-view-header">
        <button className="stage-view-back" onClick={onBack} title="Back">
          ←
        </button>
        <div className="stage-view-titles">
          <div className="stage-view-campaign-name">{campaign.name}</div>
          <h1 className="stage-view-stage-name">
            {stage.name}
          </h1>
        </div>
      </div>

      <div className="stage-view-new-chat" onClick={onNewChat}>
        <span className="stage-view-new-chat-icon">+</span>
        <span className="stage-view-new-chat-text">New chat in {stage.name}</span>
      </div>

      <div className="stage-view-tabs">
        <button
          className={`stage-view-tab ${activeTab === 'chats' ? 'active' : ''}`}
          onClick={() => setActiveTab('chats')}
        >
          Chats
        </button>
        <button
          className={`stage-view-tab ${activeTab === 'sources' ? 'active' : ''}`}
          onClick={() => setActiveTab('sources')}
        >
          Sources
          {sources.length > 0 && <span className="stage-view-tab-count">{sources.length}</span>}
        </button>
        <button
          className={`stage-view-tab ${activeTab === 'experts' ? 'active' : ''}`}
          onClick={() => setActiveTab('experts')}
        >
          Experts
          {stageDebateConfig && <span className="stage-view-tab-count">&#x2713;</span>}
        </button>
      </div>

      <div className="stage-view-content">
        {activeTab === 'chats' && (
          <div className="stage-view-chats">
            {stageConversations.length === 0 ? (
              <div className="stage-view-empty">
                <div className="stage-view-empty-text">No chats yet</div>
                <div className="stage-view-empty-hint">
                  Start a new chat to begin working on this stage
                </div>
              </div>
            ) : (
              stageConversations.map(conv => (
                <React.Fragment key={conv.id}>
                <div
                  className="stage-view-chat-item"
                  onClick={() => {
                    if (renamingChatId !== conv.id && confirmDeleteId !== conv.id) {
                      onSelectChat(conv.id);
                    }
                  }}
                >
                  <div className="stage-view-chat-info">
                    {renamingChatId === conv.id ? (
                      <input
                        ref={renameInputRef}
                        className="stage-view-rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={handleRenameKeyDown}
                        onBlur={commitRename}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div className="stage-view-chat-title">
                        {conv.title || 'New Conversation'}
                        {chatDebateConfigs[conv.id] && (
                          <span className="expert-config-chat-badge">Custom Experts</span>
                        )}
                      </div>
                    )}
                    {conv.last_message && renamingChatId !== conv.id && (
                      <div className="stage-view-chat-preview">
                        {conv.last_message}
                      </div>
                    )}
                  </div>

                  {confirmDeleteId === conv.id ? (
                    <div className="stage-view-delete-confirm" onClick={(e) => e.stopPropagation()}>
                      <span className="stage-view-delete-label">Delete?</span>
                      <button className="stage-view-confirm-yes" onClick={confirmDelete}>Yes</button>
                      <button className="stage-view-confirm-no" onClick={() => setConfirmDeleteId(null)}>No</button>
                    </div>
                  ) : (
                    <>
                      <div className="stage-view-chat-date">
                        {formatDate(conv.created_at)}
                      </div>
                      <button
                        className="stage-view-chat-menu-btn"
                        onClick={(e) => openChatMenu(e, conv.id)}
                        title="More actions"
                      >
                        <EllipsisIcon />
                      </button>
                    </>
                  )}
                </div>
                {configuringChatId === conv.id && (
                  <div className="stage-view-chat-expert-panel" onClick={(e) => e.stopPropagation()}>
                    <div className="stage-view-chat-expert-panel-header">
                      <span>Configure Experts for: {conv.title || 'New Conversation'}</span>
                      <button
                        className="expert-config-remove"
                        onClick={() => setConfiguringChatId(null)}
                      >&times;</button>
                    </div>
                    <StageExpertConfig
                      debateModels={chatDebateConfigs[conv.id]?.debate_models || stageDebateConfig?.debate_models || inheritedConfig?.debate_models || ['', '']}
                      debateRoles={chatDebateConfigs[conv.id]?.debate_roles || stageDebateConfig?.debate_roles || inheritedConfig?.debate_roles || ['', '']}
                      onSave={(models, roles) => handleSaveChatConfig(conv.id, models, roles)}
                      onClear={() => handleClearChatConfig(conv.id)}
                      configSource={chatDebateConfigs[conv.id] ? 'chat' : 'global'}
                      isSaving={savingExpertConfig}
                    />
                  </div>
                )}
                </React.Fragment>
              ))
            )}
          </div>
        )}

        {activeTab === 'experts' && (
          <div className="stage-view-experts">
            {loadingExpertConfig ? (
              <div className="stage-view-empty">
                <div className="stage-view-empty-text">Loading expert config...</div>
              </div>
            ) : (
              <StageExpertConfig
                debateModels={stageDebateConfig?.debate_models || inheritedConfig?.debate_models || ['', '']}
                debateRoles={stageDebateConfig?.debate_roles || inheritedConfig?.debate_roles || ['', '']}
                onSave={handleSaveStageConfig}
                onClear={handleClearStageConfig}
                configSource={stageDebateConfig ? 'stage' : 'global'}
                isSaving={savingExpertConfig}
                inheritedFrom={!stageDebateConfig && inheritedConfig ? inheritedConfig : null}
              />
            )}
          </div>
        )}

        {activeTab === 'sources' && (
          <div
            className={`stage-view-sources ${dragActive ? 'drag-active' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <div className="stage-view-sources-header">
              <p className="stage-view-sources-desc">
                Sources are shared across all chats in this campaign. Upload documents to provide
                persistent context for every conversation.
              </p>
              <div className="stage-view-source-actions">
                <button
                  className="stage-view-upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? 'Uploading...' : '+ Add file'}
                </button>
                <button
                  className="stage-view-upload-btn stage-view-add-text-btn"
                  onClick={openTextModal}
                >
                  + Add text
                </button>
                <button
                  className="stage-view-upload-btn stage-view-screenshot-btn"
                  onClick={handlePasteFromClipboard}
                  title="Paste a screenshot from your clipboard (or press Ctrl+V)"
                >
                  + Screenshot
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="stage-view-file-input"
                multiple
                accept=".pdf,.docx,.doc,.txt,.html,.htm,.md,.csv,.png,.jpg,.jpeg,.gif,.webp"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    handleUpload(Array.from(e.target.files));
                    e.target.value = '';
                  }
                }}
              />
            </div>

            {uploadError && (
              <div className="stage-view-upload-error" onClick={() => setUploadError(null)}>
                {uploadError}
              </div>
            )}

            {loadingSources ? (
              <div className="stage-view-empty">
                <div className="stage-view-empty-text">Loading sources...</div>
              </div>
            ) : sources.length === 0 ? (
              <div className="stage-view-empty">
                <div className="stage-view-empty-text">No sources yet</div>
                <div className="stage-view-empty-hint">
                  Drag & drop files here, or click "Add source" to upload documents
                  that provide context for all chats in this campaign.
                </div>
              </div>
            ) : (
              <div className="stage-view-sources-list">
                {sources.map(source => (
                  <div key={source.id} className="stage-view-source-item">
                    <div className="stage-view-source-info">
                      {renamingSourceId === source.id ? (
                        <input
                          ref={sourceRenameInputRef}
                          className="stage-view-rename-input"
                          value={sourceRenameValue}
                          onChange={(e) => setSourceRenameValue(e.target.value)}
                          onKeyDown={handleSourceRenameKeyDown}
                          onBlur={commitSourceRename}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <div className="stage-view-source-name">{source.original_name}</div>
                      )}
                    </div>
                    {renamingSourceId !== source.id && (
                      <div className="stage-view-source-meta">
                        {formatSize(source.size)}
                        {source.uploaded_at && ` · ${formatAbsoluteDate(source.uploaded_at)}`}
                      </div>
                    )}
                    {confirmDeleteSourceId === source.id ? (
                      <div className="stage-view-delete-confirm" onClick={(e) => e.stopPropagation()}>
                        <span className="stage-view-delete-label">Delete?</span>
                        <button className="stage-view-confirm-yes" onClick={confirmDeleteSource}>Yes</button>
                        <button className="stage-view-confirm-no" onClick={() => setConfirmDeleteSourceId(null)}>No</button>
                      </div>
                    ) : (
                      <button
                        className="stage-view-source-menu-btn"
                        onClick={(e) => openSourceMenu(e, source.id)}
                        title="More actions"
                      >
                        <EllipsisIcon />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {dragActive && (
              <div className="stage-view-drop-overlay">
                <div className="stage-view-drop-text">Drop files to upload</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Text source modal */}
      {showTextModal && (
        <div className="stage-view-text-modal-overlay" onClick={() => setShowTextModal(false)}>
          <div className="stage-view-text-modal" onClick={(e) => e.stopPropagation()}>
            <div className="stage-view-text-modal-header">
              <h3>Add Text Source</h3>
              <button className="stage-view-text-modal-close" onClick={() => setShowTextModal(false)}>
                &times;
              </button>
            </div>
            <input
              className="stage-view-text-modal-name"
              type="text"
              placeholder="Source name (e.g. Competitor Homepage Copy)"
              value={textSourceName}
              onChange={(e) => setTextSourceName(e.target.value)}
            />
            <textarea
              ref={textAreaRef}
              className="stage-view-text-modal-content"
              placeholder="Paste or type your text here..."
              value={textSourceContent}
              onChange={(e) => setTextSourceContent(e.target.value)}
            />
            <div className="stage-view-text-modal-footer">
              <span className="stage-view-text-modal-hint">
                {textSourceContent.length > 0
                  ? `${textSourceContent.length.toLocaleString()} characters`
                  : 'Text will be saved as a source available to all chats'}
              </span>
              <div className="stage-view-text-modal-buttons">
                <button
                  className="stage-view-text-modal-cancel"
                  onClick={() => setShowTextModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="stage-view-text-modal-save"
                  onClick={handleSaveTextSource}
                  disabled={savingText || !textSourceContent.trim()}
                >
                  {savingText ? 'Saving...' : 'Save Source'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Screenshot preview modal */}
      {showScreenshotModal && screenshotPreview && (
        <div className="stage-view-text-modal-overlay" onClick={closeScreenshotModal}>
          <div className="stage-view-text-modal stage-view-screenshot-modal" onClick={(e) => e.stopPropagation()}>
            <div className="stage-view-text-modal-header">
              <h3>Add Screenshot</h3>
              <button className="stage-view-text-modal-close" onClick={closeScreenshotModal}>
                &times;
              </button>
            </div>
            <div className="stage-view-screenshot-preview">
              <img src={screenshotPreview.url} alt="Screenshot preview" />
            </div>
            <input
              ref={screenshotNameRef}
              className="stage-view-text-modal-name"
              type="text"
              placeholder="Screenshot name (e.g. Landing Page Hero)"
              value={screenshotName}
              onChange={(e) => setScreenshotName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleSaveScreenshot(); }
                if (e.key === 'Escape') { e.preventDefault(); closeScreenshotModal(); }
              }}
            />
            <div className="stage-view-text-modal-footer">
              <span className="stage-view-text-modal-hint">
                Full image captured{screenshotPreview.width ? ` · ${screenshotPreview.width}×${screenshotPreview.height}px` : ''}{screenshotPreview.blob ? ` · ${formatSize(screenshotPreview.blob.size)}` : ''}
              </span>
              <div className="stage-view-text-modal-buttons">
                <button
                  className="stage-view-text-modal-cancel"
                  onClick={closeScreenshotModal}
                >
                  Cancel
                </button>
                <button
                  className="stage-view-text-modal-save"
                  onClick={handleSaveScreenshot}
                  disabled={savingScreenshot}
                >
                  {savingScreenshot ? 'Saving...' : 'Save Screenshot'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Source context menu */}
      {sourceMenu && (
        <div
          ref={sourceMenuRef}
          className="context-menu"
          style={{ left: sourceMenu.x, top: sourceMenu.y }}
        >
          <button className="context-menu-item" onClick={() => handleSourceMenuAction('open')}>
            Open
          </button>
          <button className="context-menu-item" onClick={() => handleSourceMenuAction('rename')}>
            Rename
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-item danger" onClick={() => handleSourceMenuAction('delete')}>
            Delete
          </button>
        </div>
      )}

      {/* Chat context menu */}
      {chatMenu && (
        <div
          ref={chatMenuRef}
          className="context-menu"
          style={{ left: chatMenu.x, top: chatMenu.y }}
        >
          <button className="context-menu-item" onClick={() => handleChatMenuAction('rename')}>
            Rename
          </button>
          <button className="context-menu-item" onClick={() => handleChatMenuAction('configure_experts')}>
            Configure Experts
          </button>
          <button className="context-menu-item" onClick={() => handleChatMenuAction('publish')}>
            Publish to Team
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-item danger" onClick={() => handleChatMenuAction('delete')}>
            Delete
          </button>
        </div>
      )}

      {/* ── Publish Dialog ──────────────────────────────────────── */}
      {publishDialog && (
        <div className="publish-overlay" onClick={() => setPublishDialog(null)}>
          <div className="publish-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1rem', color: 'var(--text-primary, #e0e0e0)' }}>Publish to Team</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-secondary, #aaa)', marginBottom: '0.25rem' }}>Title</label>
                <input
                  type="text"
                  value={publishDialog.title}
                  onChange={(e) => setPublishDialog(prev => ({ ...prev, title: e.target.value }))}
                  style={{
                    width: '100%', padding: '0.5rem 0.75rem',
                    background: 'var(--bg-primary, #1a1a2e)',
                    border: '1px solid var(--border-color, #2a2a4a)',
                    borderRadius: '6px', color: 'var(--text-primary, #e0e0e0)',
                    fontSize: '0.875rem', boxSizing: 'border-box',
                  }}
                  autoFocus
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-secondary, #aaa)', marginBottom: '0.25rem' }}>Description</label>
                <textarea
                  value={publishDialog.description}
                  onChange={(e) => setPublishDialog(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="What are you sharing and why?"
                  rows={3}
                  style={{
                    width: '100%', padding: '0.5rem 0.75rem',
                    background: 'var(--bg-primary, #1a1a2e)',
                    border: '1px solid var(--border-color, #2a2a4a)',
                    borderRadius: '6px', color: 'var(--text-primary, #e0e0e0)',
                    fontSize: '0.875rem', resize: 'vertical',
                    fontFamily: 'inherit', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button
                  onClick={() => setPublishDialog(null)}
                  style={{
                    padding: '0.5rem 1rem', background: 'transparent',
                    border: '1px solid var(--border-color, #2a2a4a)',
                    borderRadius: '6px', color: 'var(--text-secondary, #aaa)',
                    cursor: 'pointer', fontSize: '0.875rem',
                  }}
                >Cancel</button>
                <button
                  onClick={async () => {
                    setPublishLoading(true);
                    try {
                      await api.publishConversation(publishDialog.conversationId, publishDialog.title, publishDialog.description);
                      setPublishDialog(null);
                    } catch (e) { console.error('Failed to publish:', e); }
                    finally { setPublishLoading(false); }
                  }}
                  disabled={publishLoading || !publishDialog.title.trim()}
                  style={{
                    padding: '0.5rem 1rem', background: 'var(--accent-color, #4a6cf7)',
                    border: 'none', borderRadius: '6px', color: 'white',
                    cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600,
                    opacity: publishLoading || !publishDialog.title.trim() ? 0.6 : 1,
                  }}
                >{publishLoading ? 'Publishing...' : 'Publish'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
