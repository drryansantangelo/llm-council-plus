import React, { useState, useRef, useEffect, useCallback } from 'react';
import './Sidebar.css';

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="7" y1="3" x2="7" y2="11" />
    <line x1="3" y1="7" x2="11" y2="7" />
  </svg>
);

const EllipsisIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <circle cx="3" cy="7" r="1.2" />
    <circle cx="7" cy="7" r="1.2" />
    <circle cx="11" cy="7" r="1.2" />
  </svg>
);

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onOpenSettings,
  isLoading,
  onAbort,
  isOpen,
  onClose,
  campaigns = [],
  currentCampaignId,
  onNewCampaign,
  onSelectStage,
  onDeleteCampaign,
  onManageCampaign,
  onNewStageConversation,
  onRenameCampaign,
  onDuplicateCampaign,
  onRenameStage,
  onDeleteStage,
  onDuplicateStage,
  onRenameConversation,
  onDuplicateConversation,
  onGoHome,
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCampaigns, setExpandedCampaigns] = useState(new Set());
  const [expandedStages, setExpandedStages] = useState(new Set());
  const [campaignsCollapsed, setCampaignsCollapsed] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [showNewCampaignInput, setShowNewCampaignInput] = useState(false);

  const [contextMenu, setContextMenu] = useState(null);
  const [renamingItem, setRenamingItem] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebarWidth');
    return saved ? parseInt(saved, 10) : 260;
  });
  const [isResizing, setIsResizing] = useState(false);

  const sidebarRef = useRef(null);
  const contextMenuRef = useRef(null);
  const renameInputRef = useRef(null);

  const convTitleMap = React.useMemo(() => {
    const map = {};
    for (const c of conversations) {
      map[c.id] = c.title || 'New Conversation';
    }
    return map;
  }, [conversations]);

  const campaignConvIds = React.useMemo(() => {
    const ids = new Set();
    for (const camp of campaigns) {
      for (const stage of (camp.stages || [])) {
        for (const cid of (stage.conversation_ids || [])) {
          ids.add(cid);
        }
      }
    }
    return ids;
  }, [campaigns]);

  const filteredConversations = conversations.filter(conv => {
    if (campaignConvIds.has(conv.id)) return false;
    if (!searchQuery.trim()) return true;
    const title = conv.title || 'New Conversation';
    return title.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const handleAbortClick = (e) => {
    e.stopPropagation();
    onAbort();
  };

  const handleCreateCampaign = (e) => {
    e.preventDefault();
    if (newCampaignName.trim() && onNewCampaign) {
      onNewCampaign(newCampaignName.trim());
      setNewCampaignName('');
      setShowNewCampaignInput(false);
    }
  };

  const statusIcon = (status) => {
    if (status === 'completed') return '✓';
    return '○';
  };

  // ── Context menu ──────────────────────────────────────────────────

  const openContextMenu = (e, type, id, extra = {}) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({
      type,
      id,
      ...extra,
      x: rect.left,
      y: rect.bottom + 4,
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        closeContextMenu();
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') closeContextMenu();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  const handleMenuAction = (action) => {
    if (!contextMenu) return;
    const { type, id, campaignId } = contextMenu;
    closeContextMenu();

    switch (action) {
      case 'rename': {
        let currentName = '';
        if (type === 'campaign') {
          currentName = campaigns.find(c => c.id === id)?.name || '';
        } else if (type === 'stage') {
          const camp = campaigns.find(c => c.id === campaignId);
          currentName = camp?.stages?.find(s => s.id === id)?.name || '';
        } else if (type === 'conversation') {
          currentName = convTitleMap[id] || '';
        }
        setRenameValue(currentName);
        setRenamingItem({ type, id, campaignId });
        break;
      }
      case 'duplicate':
        if (type === 'campaign') onDuplicateCampaign?.(id);
        else if (type === 'stage') onDuplicateStage?.(campaignId, id);
        else if (type === 'conversation') onDuplicateConversation?.(id);
        break;
      case 'delete':
        if (type === 'campaign') {
          setConfirmingDelete({ type: 'campaign', id });
        } else if (type === 'stage') {
          onDeleteStage?.(campaignId, id);
        } else if (type === 'conversation') {
          onDeleteConversation?.(id);
        }
        break;
      case 'manage':
        onManageCampaign?.(id);
        break;
      default:
        break;
    }
  };

  // ── Rename ────────────────────────────────────────────────────────

  useEffect(() => {
    if (renamingItem && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingItem]);

  const renamingRef = useRef(false);

  const commitRename = () => {
    if (renamingRef.current) return;
    if (!renamingItem || !renameValue.trim()) {
      setRenamingItem(null);
      return;
    }
    renamingRef.current = true;
    const { type, id, campaignId } = renamingItem;
    if (type === 'campaign') onRenameCampaign?.(id, renameValue.trim());
    else if (type === 'stage') onRenameStage?.(campaignId, id, renameValue.trim());
    else if (type === 'conversation') onRenameConversation?.(id, renameValue.trim());
    setRenamingItem(null);
    setTimeout(() => { renamingRef.current = false; }, 100);
  };

  const cancelRename = () => setRenamingItem(null);

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
  };

  // ── Resize ────────────────────────────────────────────────────────

  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (e) => {
      const newWidth = Math.min(500, Math.max(200, startWidth + (e.clientX - startX)));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem('sidebarWidth', sidebarWidth.toString());
  }, [sidebarWidth]);

  // ── Delete confirmation for campaigns ─────────────────────────────

  const handleConfirmCampaignDelete = (e) => {
    e.stopPropagation();
    if (confirmingDelete?.type === 'campaign') {
      onDeleteCampaign?.(confirmingDelete.id);
    }
    setConfirmingDelete(null);
  };

  // ── Render helpers ────────────────────────────────────────────────

  const isRenaming = (type, id) =>
    renamingItem?.type === type && renamingItem?.id === id;

  const renderRenameInput = () => (
    <input
      ref={renameInputRef}
      className="rename-input"
      value={renameValue}
      onChange={(e) => setRenameValue(e.target.value)}
      onKeyDown={handleRenameKeyDown}
      onBlur={commitRename}
      onClick={(e) => e.stopPropagation()}
    />
  );

  return (
    <>
      {isOpen && <div className="sidebar-backdrop" onClick={onClose} />}

      <div
        ref={sidebarRef}
        className={`sidebar ${isOpen ? 'open' : ''} ${isResizing ? 'resizing' : ''}`}
        style={{ width: sidebarWidth }}
      >
        <button className="sidebar-close-btn" onClick={onClose} aria-label="Close menu">
          ×
        </button>

        <div className="sidebar-fixed-top">
          <div className="sidebar-header">
            <div className="sidebar-brand" onClick={onGoHome} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onGoHome?.(); }}>
              <img src="/dm-logo-white.svg" alt="Dynamic Media" className="sidebar-logo" />
              <span className="sidebar-app-name">DM Debate <span className="sidebar-app-accent">Studio</span></span>
            </div>
            <button className="icon-button" onClick={onOpenSettings} title="Settings">
              ⚙️
            </button>
          </div>

          <button className="sidebar-new-debate" onClick={onNewConversation}>
            <PlusIcon />
            <span>New Debate</span>
          </button>

          <div className="sidebar-search">
            <input
              type="text"
              className="search-input"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery('')} title="Clear search">
                ×
              </button>
            )}
          </div>
        </div>

        <div className="sidebar-scrollable">
          {/* ── Campaigns Section ──────────────────────────────────── */}
          <div className="campaigns-section">
            <div className="campaigns-header" onClick={() => setCampaignsCollapsed(!campaignsCollapsed)}>
              <span className={`collapse-arrow ${campaignsCollapsed ? 'collapsed' : ''}`}>▾</span>
              <span className="campaigns-title">Campaigns</span>
              {campaigns.length > 0 && <span className="campaigns-count">{campaigns.length}</span>}
              <button
                className="section-add-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  if (campaignsCollapsed) setCampaignsCollapsed(false);
                  setShowNewCampaignInput(true);
                }}
                title="New campaign"
              >
                <PlusIcon />
              </button>
            </div>

            {!campaignsCollapsed && (
              <>
                {showNewCampaignInput && (
                  <form className="new-campaign-form" onSubmit={handleCreateCampaign}>
                    <input
                      type="text"
                      className="new-campaign-input"
                      placeholder="Campaign name..."
                      value={newCampaignName}
                      onChange={(e) => setNewCampaignName(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setShowNewCampaignInput(false);
                          setNewCampaignName('');
                        }
                      }}
                    />
                    <div className="new-campaign-actions">
                      <button type="submit" className="campaign-create-btn" disabled={!newCampaignName.trim()}>Create</button>
                      <button type="button" className="campaign-cancel-btn" onClick={() => { setShowNewCampaignInput(false); setNewCampaignName(''); }}>Cancel</button>
                    </div>
                  </form>
                )}

                {campaigns.length > 0 && (
                  <div className="campaigns-list">
                    {campaigns.map((campaign) => (
                      <div key={campaign.id} className="campaign-item">
                        <div
                          className={`campaign-header-row ${expandedCampaigns.has(campaign.id) ? 'expanded' : ''}`}
                          onClick={() => setExpandedCampaigns(prev => {
                            const next = new Set(prev);
                            if (next.has(campaign.id)) next.delete(campaign.id);
                            else next.add(campaign.id);
                            return next;
                          })}
                        >
                          <span className={`collapse-arrow small ${expandedCampaigns.has(campaign.id) ? '' : 'collapsed'}`}>▾</span>
                          {isRenaming('campaign', campaign.id) ? (
                            renderRenameInput()
                          ) : (
                            <span className="campaign-name">{campaign.name}</span>
                          )}
                          <span className="campaign-stage-count">{campaign.stage_count || campaign.stages?.length || 0}</span>

                          {confirmingDelete?.type === 'campaign' && confirmingDelete?.id === campaign.id ? (
                            <div className="delete-confirm" onClick={e => e.stopPropagation()}>
                              <button className="confirm-yes-btn" onClick={handleConfirmCampaignDelete} title="Confirm">✓</button>
                              <button className="confirm-no-btn" onClick={(e) => { e.stopPropagation(); setConfirmingDelete(null); }} title="Cancel">✕</button>
                            </div>
                          ) : (
                            <button
                              className="row-action-btn"
                              onClick={(e) => openContextMenu(e, 'campaign', campaign.id)}
                              title="More actions"
                            >
                              <EllipsisIcon />
                            </button>
                          )}
                        </div>

                        {expandedCampaigns.has(campaign.id) && (
                          <div className="campaign-stages">
                            {(campaign.stages || []).map((stage) => {
                              const convIds = stage.conversation_ids || [];
                              const validConvIds = convIds.filter(cid => cid in convTitleMap);
                              const hasChats = validConvIds.length > 0;
                              const isStageActive = convIds.includes(currentConversationId);
                              const isExpanded = expandedStages.has(stage.id);

                              return (
                                <div key={stage.id} className="stage-item-group">
                                  <div
                                    className={`stage-item ${isStageActive ? 'active' : ''}`}
                                    onClick={() => {
                                      if (hasChats) {
                                        setExpandedStages(prev => {
                                          const next = new Set(prev);
                                          if (next.has(stage.id)) next.delete(stage.id);
                                          else next.add(stage.id);
                                          return next;
                                        });
                                      }
                                      onSelectStage && onSelectStage(campaign.id, stage, null);
                                    }}
                                  >
                                    <span
                                      className={`collapse-arrow tiny ${hasChats ? (isExpanded ? '' : 'collapsed') : 'placeholder'}`}
                                    >▾</span>
                                    {isRenaming('stage', stage.id) ? (
                                      renderRenameInput()
                                    ) : (
                                      <span className="stage-name">{stage.name}</span>
                                    )}
                                    {validConvIds.length > 1 && (
                                      <span className="stage-conv-count">{validConvIds.length}</span>
                                    )}
                                    <div className="row-actions">
                                      <button
                                        className="row-action-btn"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onNewStageConversation && onNewStageConversation(campaign.id, stage.id);
                                        }}
                                        title="New chat"
                                      >
                                        <PlusIcon />
                                      </button>
                                      <button
                                        className="row-action-btn"
                                        onClick={(e) => openContextMenu(e, 'stage', stage.id, { campaignId: campaign.id })}
                                        title="More actions"
                                      >
                                        <EllipsisIcon />
                                      </button>
                                    </div>
                                  </div>

                                  {isExpanded && hasChats && (
                                    <div className="stage-conversations">
                                      {validConvIds.map((cid) => (
                                        <div
                                          key={cid}
                                          className={`stage-conv-item ${cid === currentConversationId ? 'active' : ''}`}
                                          onClick={() => onSelectStage && onSelectStage(campaign.id, stage, cid)}
                                        >
                                          {isRenaming('conversation', cid) ? (
                                            renderRenameInput()
                                          ) : (
                                            <span className="stage-conv-title">{convTitleMap[cid] || 'Chat'}</span>
                                          )}
                                          <button
                                            className="row-action-btn"
                                            onClick={(e) => openContextMenu(e, 'conversation', cid)}
                                            title="More actions"
                                          >
                                            <EllipsisIcon />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            <button
                              className="manage-campaign-btn"
                              onClick={(e) => { e.stopPropagation(); onManageCampaign && onManageCampaign(campaign.id); }}
                            >
                              Manage Stages
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Recents ────────────────────────────────────────────── */}
          <div className="recents-section">
            <div className="recents-label">
              <span>Debates and Chats</span>
              <button
                className="section-add-btn"
                onClick={onNewConversation}
                disabled={isLoading}
                title="New chat"
              >
                <PlusIcon />
              </button>
            </div>
            <div className="conversation-list">
              {filteredConversations.length === 0 ? (
                <div className="sidebar-empty-state">
                  {searchQuery ? 'No matching conversations' : 'No history'}
                </div>
              ) : (
                filteredConversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`conversation-item ${conv.id === currentConversationId ? 'active' : ''}`}
                    onClick={() => {
                      if (!isRenaming('conversation', conv.id)) {
                        onSelectConversation(conv.id);
                      }
                    }}
                  >
                    {isRenaming('conversation', conv.id) ? (
                      renderRenameInput()
                    ) : (
                      <span className="conversation-title">
                        {conv.title || 'New Conversation'}
                      </span>
                    )}
                    <div className="conversation-actions">
                      {isLoading && conv.id === currentConversationId ? (
                        <button className="stop-generation-btn small" onClick={handleAbortClick}>
                          Stop
                        </button>
                      ) : (
                        <button
                          className="row-action-btn"
                          onClick={(e) => openContextMenu(e, 'conversation', conv.id)}
                          title="More actions"
                        >
                          <EllipsisIcon />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Resize handle */}
        <div
          className="sidebar-resize-handle"
          onMouseDown={handleResizeStart}
        />
      </div>

      {/* ── Context Menu (portal-style fixed position) ──────────── */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button className="context-menu-item" onClick={() => handleMenuAction('rename')}>
            Rename
          </button>
          <button className="context-menu-item" onClick={() => handleMenuAction('duplicate')}>
            Duplicate
          </button>
          {contextMenu.type === 'campaign' && (
            <button className="context-menu-item" onClick={() => handleMenuAction('manage')}>
              Manage Stages
            </button>
          )}
          <div className="context-menu-divider" />
          <button className="context-menu-item danger" onClick={() => handleMenuAction('delete')}>
            Delete
          </button>
        </div>
      )}

      {/* Transparent overlay to prevent interactions while resizing */}
      {isResizing && <div className="resize-overlay" />}
    </>
  );
}
