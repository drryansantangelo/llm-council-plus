import './CampaignBar.css';

export default function CampaignBar({ campaign, stage, currentConversationId, onManage }) {
  if (!campaign || !stage) return null;

  const stageIndex = campaign.stages?.findIndex(s => s.id === stage.id) ?? -1;
  const totalStages = campaign.stages?.length ?? 0;
  const convIds = stage.conversation_ids || [];
  const chatIndex = convIds.indexOf(currentConversationId);
  const showChatCount = convIds.length > 1;

  return (
    <div className="campaign-bar">
      <div className="campaign-bar-info">
        <span className="campaign-bar-badge">Campaign</span>
        <span className="campaign-bar-name">{campaign.name}</span>
        <span className="campaign-bar-separator">/</span>
        <span className="campaign-bar-stage">{stage.name}</span>
        {totalStages > 0 && (
          <span className="campaign-bar-position">
            Stage {stageIndex + 1} of {totalStages}
            {showChatCount && ` · Chat ${chatIndex + 1} of ${convIds.length}`}
          </span>
        )}
      </div>
      <button className="campaign-bar-manage" onClick={onManage}>
        Manage Stages
      </button>
    </div>
  );
}
