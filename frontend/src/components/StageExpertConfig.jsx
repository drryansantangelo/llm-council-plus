import React, { useState, useEffect, useCallback } from 'react';
import SearchableModelSelect from './SearchableModelSelect';
import { api } from '../api';
import './StageExpertConfig.css';

const ROLE_PRESETS = [
  {
    id: 'conversion_strategist',
    name: 'Conversion Strategist',
    description: 'You are a conversion optimization expert. Focus on direct response marketing, CTA effectiveness, conversion funnel optimization, A/B testing opportunities, and measurable ROI. Every recommendation should tie back to driving conversions.',
  },
  {
    id: 'brand_strategist',
    name: 'Brand Strategist',
    description: 'You are a brand strategy expert. Focus on brand consistency, emotional storytelling, audience connection, trust-building, and long-term brand positioning. Consider how every touchpoint reinforces the brand narrative.',
  },
  {
    id: 'email_specialist',
    name: 'Email Marketing Specialist',
    description: 'You are an email marketing expert. Focus on email sequences, subject line optimization, open/click rates, list segmentation, nurture flow design, and deliverability. Provide specific copy angles and timing recommendations.',
  },
  {
    id: 'ux_analyst',
    name: 'UX/Design Analyst',
    description: 'You are a UX and design expert. Focus on user experience, visual hierarchy, page flow, friction points, mobile responsiveness, and accessibility. Consider how design choices impact user behavior and conversions.',
  },
  {
    id: 'data_marketer',
    name: 'Data-Driven Marketer',
    description: 'You are a data-driven marketing expert. Focus on analytics, KPIs, attribution modeling, A/B testing frameworks, and data-backed decisions. Recommend specific metrics to track and benchmarks to aim for.',
  },
  {
    id: 'general_strategist',
    name: 'General Strategist',
    description: 'You are a senior strategist with broad expertise. Analyze the topic holistically, considering multiple angles, trade-offs, and implementation challenges. Provide well-reasoned, actionable recommendations.',
  },
  {
    id: 'ppc_specialist',
    name: 'PPC / Paid Ads Specialist',
    description: 'You are a pay-per-click advertising expert. Focus on Google Ads, campaign structure, keyword strategy, quality score optimization, bid management, ad copy testing, and ROAS. Recommend specific tactics for paid search and display.',
  },
  {
    id: 'landing_page_specialist',
    name: 'Landing Page / CRO Specialist',
    description: 'You are a landing page and conversion rate optimization expert. Focus on page layout, headline hierarchy, social proof placement, form optimization, page speed, above-the-fold content, and A/B testing strategies to maximize conversion rates.',
  },
  {
    id: 'seo_specialist',
    name: 'SEO Specialist',
    description: 'You are a search engine optimization expert. Focus on on-page SEO, keyword targeting, meta tags, content structure, internal linking, technical SEO, and search intent alignment. Provide actionable recommendations for organic visibility.',
  },
  {
    id: 'social_media_specialist',
    name: 'Social Media Specialist',
    description: 'You are a social media marketing expert. Focus on platform-specific strategies, content calendars, engagement tactics, influencer collaboration, paid social campaigns, and community building across key platforms.',
  },
];

function findPresetForRole(roleText) {
  if (!roleText) return null;
  return ROLE_PRESETS.find(p => p.description === roleText) || null;
}

export default function StageExpertConfig({
  debateModels: initialModels,
  debateRoles: initialRoles,
  onSave,
  onClear,
  configSource,
  isSaving,
}) {
  const [models, setModels] = useState(initialModels || ['', '']);
  const [roles, setRoles] = useState(initialRoles || ['', '']);
  const [roleMode, setRoleMode] = useState(() =>
    (initialRoles || ['', '']).map(role => {
      const preset = findPresetForRole(role);
      return preset ? preset.id : (role ? 'custom' : '');
    })
  );

  const [availableModels, setAvailableModels] = useState([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setModels(initialModels || ['', '']);
    setRoles(initialRoles || ['', '']);
    setRoleMode(
      (initialRoles || ['', '']).map(role => {
        const preset = findPresetForRole(role);
        return preset ? preset.id : (role ? 'custom' : '');
      })
    );
    setDirty(false);
  }, [initialModels, initialRoles]);

  const loadModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const data = await api.getModels();
      if (data.models?.length > 0) {
        const sorted = data.models.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setAvailableModels(sorted);
      }
    } catch (err) {
      console.error('Failed to load models:', err);
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const handleModelChange = (index, value) => {
    const next = [...models];
    next[index] = value;
    setModels(next);
    setDirty(true);
  };

  const handleRolePresetChange = (index, presetId) => {
    const nextMode = [...roleMode];
    nextMode[index] = presetId;
    setRoleMode(nextMode);

    const nextRoles = [...roles];
    if (presetId === 'custom') {
      nextRoles[index] = '';
    } else {
      const preset = ROLE_PRESETS.find(p => p.id === presetId);
      if (preset) nextRoles[index] = preset.description;
    }
    setRoles(nextRoles);
    setDirty(true);
  };

  const handleCustomRoleText = (index, text) => {
    const nextRoles = [...roles];
    nextRoles[index] = text;
    setRoles(nextRoles);
    setDirty(true);
  };

  const handleAddExpert = () => {
    if (models.length >= 3) return;
    setModels([...models, '']);
    setRoles([...roles, '']);
    setRoleMode([...roleMode, '']);
    setDirty(true);
  };

  const handleRemoveExpert = (index) => {
    setModels(models.filter((_, i) => i !== index));
    setRoles(roles.filter((_, i) => i !== index));
    setRoleMode(roleMode.filter((_, i) => i !== index));
    setDirty(true);
  };

  const handleSave = () => {
    onSave(models, roles);
    setDirty(false);
  };

  const isCustom = configSource !== 'global';

  return (
    <div className="expert-config">
      <div className="expert-config-header">
        <div className="expert-config-header-text">
          <p className="expert-config-description">
            {configSource === 'global'
              ? 'No custom experts configured. Using global defaults from Settings.'
              : configSource === 'stage'
                ? 'Custom experts configured for this stage. All chats in this stage will use these experts unless individually overridden.'
                : 'Custom experts configured for this chat, overriding the stage default.'
            }
          </p>
        </div>
        {isCustom && (
          <div className="expert-config-source-badge">
            <span className="expert-config-badge">{configSource === 'stage' ? 'Stage Override' : 'Chat Override'}</span>
          </div>
        )}
      </div>

      <div className="expert-config-experts">
        {models.map((modelId, index) => {
          const currentMode = roleMode[index] || '';
          const isCustomRole = currentMode === 'custom';

          return (
            <div key={index} className="expert-config-card">
              <div className="expert-config-card-header">
                <span className="expert-config-card-label">Expert {index + 1}</span>
                {index >= 1 && models.length > 1 && (
                  <button
                    type="button"
                    className="expert-config-remove"
                    onClick={() => handleRemoveExpert(index)}
                    title="Remove"
                  >
                    &times;
                  </button>
                )}
              </div>

              <div className="expert-config-field">
                <label className="expert-config-field-label">Model</label>
                <SearchableModelSelect
                  models={availableModels}
                  value={modelId}
                  onChange={(value) => handleModelChange(index, value)}
                  placeholder={isLoadingModels ? 'Loading...' : 'Select model...'}
                  isDisabled={isLoadingModels && availableModels.length === 0}
                  isLoading={isLoadingModels}
                  allModels={availableModels}
                />
              </div>

              <div className="expert-config-field">
                <label className="expert-config-field-label">Role</label>
                <select
                  className="expert-config-role-select"
                  value={currentMode}
                  onChange={(e) => handleRolePresetChange(index, e.target.value)}
                >
                  <option value="">Select a role...</option>
                  {ROLE_PRESETS.map(preset => (
                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                  ))}
                  <option value="custom">Custom Role</option>
                </select>

                {isCustomRole && (
                  <textarea
                    className="expert-config-custom-role"
                    placeholder="Describe this expert's role and focus areas..."
                    value={roles[index] || ''}
                    onChange={(e) => handleCustomRoleText(index, e.target.value)}
                    rows={3}
                  />
                )}

                {currentMode && currentMode !== 'custom' && (
                  <p className="expert-config-role-preview">
                    {ROLE_PRESETS.find(p => p.id === currentMode)?.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="expert-config-add"
        onClick={handleAddExpert}
        disabled={models.length >= 3}
      >
        + Add Expert {models.length >= 3 ? '(max 3)' : ''}
      </button>

      <div className="expert-config-actions">
        <button
          type="button"
          className="expert-config-save"
          onClick={handleSave}
          disabled={isSaving || !dirty}
        >
          {isSaving ? 'Saving...' : 'Save Expert Config'}
        </button>
        {isCustom && (
          <button
            type="button"
            className="expert-config-clear"
            onClick={onClear}
            disabled={isSaving}
          >
            Clear Override
          </button>
        )}
      </div>
    </div>
  );
}
