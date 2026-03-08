import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
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
  const fileInputRef = useRef(null);

  const [chatMenu, setChatMenu] = useState(null);
  const [renamingChatId, setRenamingChatId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const chatMenuRef = useRef(null);
  const renameInputRef = useRef(null);

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

  // ── Sources ───────────────────────────────────────────────────────

  const handleUpload = async (files) => {
    if (!files?.length || !campaign?.id) return;
    setUploading(true);
    try {
      for (const file of files) {
        await api.uploadCampaignSource(campaign.id, file);
      }
      await loadSources();
    } catch (err) {
      console.error('Upload failed:', err);
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
                <div
                  key={conv.id}
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
              ))
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
              <button
                className="stage-view-upload-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Uploading...' : '+ Add source'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="stage-view-file-input"
                multiple
                accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    handleUpload(Array.from(e.target.files));
                    e.target.value = '';
                  }
                }}
              />
            </div>

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
                      <div className="stage-view-source-name">{source.original_name}</div>
                      <div className="stage-view-source-meta">
                        {formatSize(source.size)}
                        {source.uploaded_at && ` · ${formatDate(source.uploaded_at)}`}
                      </div>
                    </div>
                    <button
                      className="stage-view-source-delete"
                      onClick={() => handleDeleteSource(source.id)}
                      title="Remove source"
                    >
                      ×
                    </button>
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
          <div className="context-menu-divider" />
          <button className="context-menu-item danger" onClick={() => handleChatMenuAction('delete')}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
