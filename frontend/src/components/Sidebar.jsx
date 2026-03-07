import React, { useState } from 'react';
import './Sidebar.css';

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
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [confirmingCampaignDelete, setConfirmingCampaignDelete] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCampaign, setExpandedCampaign] = useState(null);
  const [campaignsCollapsed, setCampaignsCollapsed] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [showNewCampaignInput, setShowNewCampaignInput] = useState(false);

  const filteredConversations = conversations.filter(conv => {
    if (!searchQuery.trim()) return true;
    const title = conv.title || 'New Conversation';
    return title.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const handleAbortClick = (e) => {
    e.stopPropagation();
    onAbort();
  };

  const handleDeleteClick = (e, convId) => {
    e.stopPropagation();
    setConfirmingDelete(convId);
  };

  const handleConfirmDelete = (e, convId) => {
    e.stopPropagation();
    onDeleteConversation(convId);
    setConfirmingDelete(null);
  };

  const handleCancelDelete = (e) => {
    e.stopPropagation();
    setConfirmingDelete(null);
  };

  const handleCreateCampaign = (e) => {
    e.preventDefault();
    if (newCampaignName.trim() && onNewCampaign) {
      onNewCampaign(newCampaignName.trim());
      setNewCampaignName('');
      setShowNewCampaignInput(false);
    }
  };

  const handleCampaignDeleteClick = (e, campaignId) => {
    e.stopPropagation();
    setConfirmingCampaignDelete(campaignId);
  };

  const handleConfirmCampaignDelete = (e, campaignId) => {
    e.stopPropagation();
    if (onDeleteCampaign) onDeleteCampaign(campaignId);
    setConfirmingCampaignDelete(null);
  };

  const statusIcon = (status) => {
    if (status === 'completed') return '✓';
    return '○';
  };

  return (
    <>
      {isOpen && <div className="sidebar-backdrop" onClick={onClose} />}

      <div className={`sidebar ${isOpen ? 'open' : ''}`}>
        <button className="sidebar-close-btn" onClick={onClose} aria-label="Close menu">
          ×
        </button>

        <div className="sidebar-header">
          <div className="sidebar-title-wrapper">
            <div className="sidebar-title">LLM Council <span className="title-plus">Plus</span></div>
            <div className="sidebar-subtitle">Created by: Jacob Ben-David</div>
            <div className="sidebar-version">v0.2.1</div>
          </div>
          <button className="icon-button" onClick={onOpenSettings} title="Settings">
            ⚙️
          </button>
        </div>

        <div className="sidebar-actions">
          <button className="new-council-btn" onClick={onNewConversation} disabled={isLoading}>
            <span className="btn-icon">+</span>
            <span className="btn-text">New Discussion</span>
          </button>
        </div>

        <div className="sidebar-search">
          <input
            type="text"
            className="search-input"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')} title="Clear search">
              ×
            </button>
          )}
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
                onClick={() => onSelectConversation(conv.id)}
              >
                <div className="conversation-title">
                  {conv.title || 'New Conversation'}
                </div>
                <div className="conversation-meta">
                  <span>{new Date(conv.created_at).toLocaleDateString()}</span>
                  {isLoading && conv.id === currentConversationId ? (
                    <button className="stop-generation-btn small" onClick={handleAbortClick}>
                      Stop
                    </button>
                  ) : confirmingDelete === conv.id ? (
                    <div className="delete-confirm">
                      <button className="confirm-yes-btn" onClick={(e) => handleConfirmDelete(e, conv.id)} title="Confirm delete">✓</button>
                      <button className="confirm-no-btn" onClick={handleCancelDelete} title="Cancel">✕</button>
                    </div>
                  ) : (
                    <button className="delete-btn" onClick={(e) => handleDeleteClick(e, conv.id)} title="Delete conversation">
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Campaigns Section */}
        <div className="campaigns-section">
          <div className="campaigns-header" onClick={() => setCampaignsCollapsed(!campaignsCollapsed)}>
            <span className={`collapse-arrow ${campaignsCollapsed ? 'collapsed' : ''}`}>▾</span>
            <span className="campaigns-title">Campaigns</span>
            <span className="campaigns-count">{campaigns.length}</span>
          </div>

          {!campaignsCollapsed && (
            <>
              <button
                className="new-campaign-btn"
                onClick={() => setShowNewCampaignInput(true)}
                disabled={showNewCampaignInput}
              >
                <span className="btn-icon">+</span>
                <span>New Campaign</span>
              </button>

              {showNewCampaignInput && (
                <form className="new-campaign-form" onSubmit={handleCreateCampaign}>
                  <input
                    type="text"
                    className="new-campaign-input"
                    placeholder="Campaign name..."
                    value={newCampaignName}
                    onChange={(e) => setNewCampaignName(e.target.value)}
                    autoFocus
                  />
                  <div className="new-campaign-actions">
                    <button type="submit" className="campaign-create-btn" disabled={!newCampaignName.trim()}>Create</button>
                    <button type="button" className="campaign-cancel-btn" onClick={() => { setShowNewCampaignInput(false); setNewCampaignName(''); }}>Cancel</button>
                  </div>
                </form>
              )}

              <div className="campaigns-list">
                {campaigns.map((campaign) => (
                  <div key={campaign.id} className="campaign-item">
                    <div
                      className={`campaign-header-row ${expandedCampaign === campaign.id ? 'expanded' : ''}`}
                      onClick={() => setExpandedCampaign(expandedCampaign === campaign.id ? null : campaign.id)}
                    >
                      <span className={`collapse-arrow small ${expandedCampaign === campaign.id ? '' : 'collapsed'}`}>▾</span>
                      <span className="campaign-name">{campaign.name}</span>
                      <span className="campaign-stage-count">{campaign.stage_count || campaign.stages?.length || 0}</span>
                      {confirmingCampaignDelete === campaign.id ? (
                        <div className="delete-confirm" onClick={e => e.stopPropagation()}>
                          <button className="confirm-yes-btn" onClick={(e) => handleConfirmCampaignDelete(e, campaign.id)} title="Confirm">✓</button>
                          <button className="confirm-no-btn" onClick={(e) => { e.stopPropagation(); setConfirmingCampaignDelete(null); }} title="Cancel">✕</button>
                        </div>
                      ) : (
                        <button className="delete-btn campaign-delete" onClick={(e) => handleCampaignDeleteClick(e, campaign.id)} title="Delete campaign">
                          🗑️
                        </button>
                      )}
                    </div>

                    {expandedCampaign === campaign.id && (
                      <div className="campaign-stages">
                        {(campaign.stages || []).map((stage) => (
                          <div
                            key={stage.id}
                            className={`stage-item ${stage.conversation_id === currentConversationId ? 'active' : ''}`}
                            onClick={() => onSelectStage && onSelectStage(campaign.id, stage)}
                          >
                            <span className={`stage-status ${stage.status || 'active'}`}>{statusIcon(stage.status)}</span>
                            <span className="stage-name">{stage.name}</span>
                          </div>
                        ))}
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
            </>
          )}
        </div>
      </div>
    </>
  );
}
