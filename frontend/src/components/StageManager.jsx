import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import './StageManager.css';

export default function StageManager({ campaignId, onClose, onSelectStage, currentConversationId }) {
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newStageName, setNewStageName] = useState('');
  const [editingStageId, setEditingStageId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [description, setDescription] = useState('');
  const [descriptionDirty, setDescriptionDirty] = useState(false);
  const [savingDescription, setSavingDescription] = useState(false);
  const saveTimeoutRef = useRef(null);

  useEffect(() => {
    loadCampaign();
  }, [campaignId]);

  const loadCampaign = async () => {
    try {
      const data = await api.getCampaign(campaignId);
      setCampaign(data);
      setDescription(data.description || '');
      setDescriptionDirty(false);
    } catch (error) {
      console.error('Failed to load campaign:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDescriptionChange = (e) => {
    setDescription(e.target.value);
    setDescriptionDirty(true);

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveDescription(e.target.value);
    }, 1500);
  };

  const saveDescription = async (text) => {
    setSavingDescription(true);
    try {
      await api.updateCampaign(campaignId, { description: text });
      setDescriptionDirty(false);
    } catch (error) {
      console.error('Failed to save description:', error);
    } finally {
      setSavingDescription(false);
    }
  };

  const handleDescriptionBlur = () => {
    if (descriptionDirty) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveDescription(description);
    }
  };

  const handleAddStage = async (e) => {
    e.preventDefault();
    if (!newStageName.trim()) return;
    try {
      await api.addStage(campaignId, newStageName.trim());
      setNewStageName('');
      await loadCampaign();
    } catch (error) {
      console.error('Failed to add stage:', error);
    }
  };

  const handleMoveStage = async (stageId, direction) => {
    if (!campaign) return;
    const stages = [...campaign.stages];
    const idx = stages.findIndex(s => s.id === stageId);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= stages.length) return;

    [stages[idx], stages[newIdx]] = [stages[newIdx], stages[idx]];
    const stageIds = stages.map(s => s.id);

    try {
      await api.reorderStages(campaignId, stageIds);
      await loadCampaign();
    } catch (error) {
      console.error('Failed to reorder stages:', error);
    }
  };

  const handleRenameStage = async (stageId) => {
    if (!editingName.trim()) {
      setEditingStageId(null);
      return;
    }
    try {
      await api.updateStage(campaignId, stageId, { name: editingName.trim() });
      setEditingStageId(null);
      await loadCampaign();
    } catch (error) {
      console.error('Failed to rename stage:', error);
    }
  };

  const handleToggleStatus = async (stageId, currentStatus) => {
    const newStatus = currentStatus === 'completed' ? 'active' : 'completed';
    try {
      await api.updateStage(campaignId, stageId, { status: newStatus });
      await loadCampaign();
    } catch (error) {
      console.error('Failed to update stage status:', error);
    }
  };

  const handleDeleteStage = async (stageId) => {
    try {
      await api.deleteStage(campaignId, stageId);
      setConfirmingDelete(null);
      await loadCampaign();
    } catch (error) {
      console.error('Failed to delete stage:', error);
    }
  };

  if (loading) {
    return (
      <div className="stage-manager-overlay" onClick={onClose}>
        <div className="stage-manager" onClick={e => e.stopPropagation()}>
          <div className="stage-manager-loading">Loading...</div>
        </div>
      </div>
    );
  }

  if (!campaign) {
    return null;
  }

  const stages = campaign.stages || [];

  return (
    <div className="stage-manager-overlay" onClick={onClose}>
      <div className="stage-manager" onClick={e => e.stopPropagation()}>
        <div className="stage-manager-header">
          <div>
            <h2 className="stage-manager-title">{campaign.name}</h2>
            <p className="stage-manager-subtitle">
              {stages.length} {stages.length === 1 ? 'stage' : 'stages'}
            </p>
          </div>
          <button className="stage-manager-close" onClick={onClose}>×</button>
        </div>

        <div className="stage-manager-body">
          <div className="campaign-brief-section">
            <div className="campaign-brief-header">
              <label className="campaign-brief-label">Campaign Brief</label>
              {savingDescription && <span className="campaign-brief-saving">Saving...</span>}
              {!savingDescription && !descriptionDirty && description && <span className="campaign-brief-saved">Saved</span>}
            </div>
            <textarea
              className="campaign-brief-textarea"
              placeholder="Describe your campaign: Who is the ICP? What's the goal? What's the strategy? This context is shared with AI experts across all stages..."
              value={description}
              onChange={handleDescriptionChange}
              onBlur={handleDescriptionBlur}
              rows={4}
            />
          </div>

          {stages.length === 0 ? (
            <div className="stage-manager-empty">
              No stages yet. Add your first funnel stage below.
            </div>
          ) : (
            <div className="stage-funnel">
              {stages.map((stage, idx) => (
                <div key={stage.id} className="funnel-stage-card">
                  <div className="funnel-connector-top" style={{ display: idx === 0 ? 'none' : 'block' }} />

                  <div className={`funnel-stage ${stage.conversation_id === currentConversationId ? 'current' : ''} ${stage.status === 'completed' ? 'completed' : ''}`}>
                    <div className="funnel-stage-left">
                      <button
                        className={`funnel-status-btn ${stage.status || 'active'}`}
                        onClick={() => handleToggleStatus(stage.id, stage.status)}
                        title={stage.status === 'completed' ? 'Mark as active' : 'Mark as completed'}
                      >
                        {stage.status === 'completed' ? '✓' : (idx + 1)}
                      </button>
                    </div>

                    <div className="funnel-stage-center">
                      {editingStageId === stage.id ? (
                        <form onSubmit={(e) => { e.preventDefault(); handleRenameStage(stage.id); }} className="funnel-edit-form">
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={() => handleRenameStage(stage.id)}
                            autoFocus
                            className="funnel-edit-input"
                          />
                        </form>
                      ) : (
                        <span
                          className="funnel-stage-name"
                          onDoubleClick={() => { setEditingStageId(stage.id); setEditingName(stage.name); }}
                        >
                          {stage.name}
                        </span>
                      )}
                      {stage.summary && (
                        <span className="funnel-has-summary" title="Has debate summary">has summary</span>
                      )}
                    </div>

                    <div className="funnel-stage-actions">
                      <button
                        className="funnel-action-btn"
                        onClick={() => onSelectStage(campaignId, stage)}
                        title="Open debate"
                      >
                        Open
                      </button>
                      <button
                        className="funnel-arrow-btn"
                        onClick={() => handleMoveStage(stage.id, -1)}
                        disabled={idx === 0}
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        className="funnel-arrow-btn"
                        onClick={() => handleMoveStage(stage.id, 1)}
                        disabled={idx === stages.length - 1}
                        title="Move down"
                      >
                        ↓
                      </button>
                      {confirmingDelete === stage.id ? (
                        <div className="funnel-delete-confirm">
                          <button className="funnel-confirm-yes" onClick={() => handleDeleteStage(stage.id)}>Delete</button>
                          <button className="funnel-confirm-no" onClick={() => setConfirmingDelete(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button
                          className="funnel-action-btn danger"
                          onClick={() => setConfirmingDelete(stage.id)}
                          title="Delete stage"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="funnel-connector-bottom" style={{ display: idx === stages.length - 1 ? 'none' : 'block' }} />
                </div>
              ))}
            </div>
          )}

          <form className="add-stage-form" onSubmit={handleAddStage}>
            <input
              type="text"
              className="add-stage-input"
              placeholder="Add a stage (e.g., Landing Page, Email Campaign)..."
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
            />
            <button type="submit" className="add-stage-btn" disabled={!newStageName.trim()}>
              + Add Stage
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
