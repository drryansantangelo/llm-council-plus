import './CampaignBar.css';

export default function CampaignBar({ campaign, stage, onManage }) {
  if (!campaign || !stage) return null;

  const stageIndex = campaign.stages?.findIndex(s => s.id === stage.id) ?? -1;
  const totalStages = campaign.stages?.length ?? 0;

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
          </span>
        )}
      </div>
      <button className="campaign-bar-manage" onClick={onManage}>
        Manage Stages
      </button>
    </div>
  );
}
