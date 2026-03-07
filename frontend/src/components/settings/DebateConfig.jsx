import React, { useState } from 'react';
import SearchableModelSelect from '../SearchableModelSelect';

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
];

function findPresetForRole(roleText) {
  if (!roleText) return null;
  return ROLE_PRESETS.find(p => p.description === roleText) || null;
}

export default function DebateConfig({
  settings,
  ollamaStatus,
  enabledProviders,
  setEnabledProviders,
  directProviderToggles,
  setDirectProviderToggles,
  showFreeOnly,
  setShowFreeOnly,
  isLoadingModels,
  debateModels,
  debateRoles,
  chairmanModel,
  setChairmanModel,
  chairmanFilter,
  setChairmanFilter,
  debateTemperature,
  setDebateTemperature,
  chairmanTemperature,
  setChairmanTemperature,
  debateMaxRounds,
  setDebateMaxRounds,
  debateAutoStop,
  setDebateAutoStop,
  allModels,
  filteredModels,
  ollamaAvailableModels,
  customEndpointName,
  customEndpointUrl,
  handleDebateModelChange,
  handleDebateRoleChange,
  handleAddDebater,
  handleRemoveDebater,
  setActiveSection,
  validationErrors = {},
  chairmanSelectRef,
}) {
  const [roleMode, setRoleMode] = useState(() => {
    return debateRoles.map(role => {
      const preset = findPresetForRole(role);
      return preset ? preset.id : (role ? 'custom' : '');
    });
  });

  const isSourceConfigured = (source) => {
    switch (source) {
      case 'openrouter': return !!settings?.openrouter_api_key_set;
      case 'ollama': return ollamaStatus?.connected;
      case 'groq': return !!settings?.groq_api_key_set;
      case 'custom': return !!(settings?.custom_endpoint_url);
      case 'openai': return !!settings?.openai_api_key_set;
      case 'anthropic': return !!settings?.anthropic_api_key_set;
      case 'google': return !!settings?.google_api_key_set;
      case 'mistral': return !!settings?.mistral_api_key_set;
      case 'deepseek': return !!settings?.deepseek_api_key_set;
      default: return false;
    }
  };

  const filterByRemoteLocal = (models, filter) => {
    if (filter === 'local') return models.filter(m => m.id.startsWith('ollama:'));
    return models.filter(m => !m.id.startsWith('ollama:'));
  };

  const handleRolePresetChange = (index, presetId) => {
    const newModes = [...roleMode];
    newModes[index] = presetId;
    setRoleMode(newModes);

    if (presetId === 'custom') {
      handleDebateRoleChange(index, '');
    } else {
      const preset = ROLE_PRESETS.find(p => p.id === presetId);
      if (preset) {
        handleDebateRoleChange(index, preset.description);
      }
    }
  };

  const handleCustomRoleText = (index, text) => {
    handleDebateRoleChange(index, text);
  };

  return (
    <>
      <section className="settings-section">
        <h3>Available Model Sources</h3>
        <p className="section-description">Toggle which providers are available for model selection.</p>

        <div className="hybrid-settings-card">
          <div className="filter-group">
            <label className={`toggle-wrapper ${!isSourceConfigured('openrouter') ? 'source-disabled' : ''}`}>
              <div className="toggle-switch">
                <input type="checkbox" checked={enabledProviders.openrouter} onChange={(e) => setEnabledProviders(prev => ({ ...prev, openrouter: e.target.checked }))} disabled={!isSourceConfigured('openrouter')} />
                <span className="slider"></span>
              </div>
              <span className="toggle-text">OpenRouter (Cloud)</span>
            </label>
            <label className={`toggle-wrapper ${!isSourceConfigured('ollama') ? 'source-disabled' : ''}`}>
              <div className="toggle-switch">
                <input type="checkbox" checked={enabledProviders.ollama} onChange={(e) => setEnabledProviders(prev => ({ ...prev, ollama: e.target.checked }))} disabled={!isSourceConfigured('ollama')} />
                <span className="slider"></span>
              </div>
              <span className="toggle-text">Local (Ollama)</span>
            </label>
            <label className={`toggle-wrapper ${!isSourceConfigured('groq') ? 'source-disabled' : ''}`}>
              <div className="toggle-switch">
                <input type="checkbox" checked={enabledProviders.groq} onChange={(e) => setEnabledProviders(prev => ({ ...prev, groq: e.target.checked }))} disabled={!isSourceConfigured('groq')} />
                <span className="slider"></span>
              </div>
              <span className="toggle-text">Groq (Fast Inference)</span>
            </label>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3>Debate Configuration</h3>
        <p className="section-description">
          Configure {debateModels.length === 1 ? '1 model for chat mode' : `${debateModels.length} models for debate mode`}. Each model can have a different expert role.
        </p>

        <div className="model-options-row">
          <div className="model-filter-controls">
            <label className="free-filter-label" style={{ opacity: enabledProviders.openrouter ? 1 : 0.3 }}>
              <input type="checkbox" checked={showFreeOnly} onChange={e => setShowFreeOnly(e.target.checked)} disabled={!enabledProviders.openrouter} />
              Show free OpenRouter models only
            </label>
            {isLoadingModels && <span className="loading-models">Loading models...</span>}
          </div>
        </div>

        <div className="subsection" style={{ marginTop: '16px' }}>
          <h4>Debaters</h4>
          <div className="council-members">
            {debateModels.map((modelId, index) => {
              const currentMode = roleMode[index] || '';
              const isCustom = currentMode === 'custom';

              return (
                <div key={index} className="debate-member-card">
                  <div className="debate-member-header">
                    <span className="member-label">Expert {index + 1}</span>
                    {index >= 1 && debateModels.length > 1 && (
                      <button type="button" className="remove-member-button" onClick={() => {
                        handleRemoveDebater(index);
                        setRoleMode(prev => prev.filter((_, i) => i !== index));
                      }} title="Remove">×</button>
                    )}
                  </div>

                  <div className="debate-member-model">
                    <label className="field-label">Model</label>
                    <SearchableModelSelect
                      models={filterByRemoteLocal(filteredModels, 'remote')}
                      value={modelId}
                      onChange={(value) => handleDebateModelChange(index, value)}
                      placeholder={isLoadingModels ? "Loading..." : "Select model..."}
                      isDisabled={isLoadingModels && allModels.length === 0}
                      isLoading={isLoadingModels}
                      allModels={allModels}
                    />
                  </div>

                  <div className="debate-member-role">
                    <label className="field-label">Role</label>
                    <select
                      className="role-select"
                      value={currentMode}
                      onChange={(e) => handleRolePresetChange(index, e.target.value)}
                    >
                      <option value="">Select a role...</option>
                      {ROLE_PRESETS.map(preset => (
                        <option key={preset.id} value={preset.id}>{preset.name}</option>
                      ))}
                      <option value="custom">Custom Role</option>
                    </select>

                    {isCustom && (
                      <textarea
                        className="custom-role-input"
                        placeholder="Describe this expert's role and focus areas..."
                        value={debateRoles[index] || ''}
                        onChange={(e) => handleCustomRoleText(index, e.target.value)}
                        rows={3}
                      />
                    )}

                    {currentMode && currentMode !== 'custom' && (
                      <p className="role-description-preview">
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
            className="add-member-button"
            onClick={() => {
              handleAddDebater();
              setRoleMode(prev => [...prev, '']);
            }}
            disabled={filteredModels.length === 0 || debateModels.length >= 3}
          >
            + Add Expert {debateModels.length >= 3 ? '(max 3)' : ''}
          </button>
        </div>

        {/* Chairman / Summarizer */}
        <div className="subsection" style={{ marginTop: '24px' }}>
          <h4>Summarizer (Chairman)</h4>
          <p className="section-description">Generates the final summary after the debate concludes.</p>
          <div ref={chairmanSelectRef}>
            <SearchableModelSelect
              models={filterByRemoteLocal(filteredModels, 'remote')}
              value={chairmanModel}
              onChange={(value) => setChairmanModel(value)}
              placeholder="Select summarizer model..."
              isLoading={isLoadingModels}
              allModels={allModels}
            />
          </div>

          <div className="subsection" style={{ marginTop: '16px' }}>
            <div className="heat-slider-header">
              <h4>Summarizer Temperature</h4>
              <span className="heat-value">{chairmanTemperature.toFixed(1)}</span>
            </div>
            <div className="heat-slider-container">
              <span className="heat-icon cold">❄️</span>
              <input type="range" min="0" max="1" step="0.1" value={chairmanTemperature} onChange={(e) => setChairmanTemperature(parseFloat(e.target.value))} className="heat-slider" />
              <span className="heat-icon hot">🔥</span>
            </div>
          </div>
        </div>

        {/* Debate Settings */}
        <div className="subsection" style={{ marginTop: '24px' }}>
          <h4>Debate Settings</h4>

          <div className="debate-settings-grid">
            <div className="debate-setting">
              <label className="field-label">Max Rounds</label>
              <select className="role-select" value={debateMaxRounds} onChange={(e) => setDebateMaxRounds(parseInt(e.target.value))}>
                <option value={1}>1 round</option>
                <option value={2}>2 rounds</option>
                <option value={3}>3 rounds</option>
                <option value={4}>4 rounds</option>
                <option value={5}>5 rounds</option>
              </select>
            </div>

            <div className="debate-setting">
              <label className="toggle-wrapper">
                <div className="toggle-switch">
                  <input type="checkbox" checked={debateAutoStop} onChange={(e) => setDebateAutoStop(e.target.checked)} />
                  <span className="slider"></span>
                </div>
                <span className="toggle-text">Auto-stop on convergence (90%+ agreement)</span>
              </label>
            </div>
          </div>

          <div className="subsection" style={{ marginTop: '16px' }}>
            <div className="heat-slider-header">
              <h4>Debate Temperature</h4>
              <span className="heat-value">{debateTemperature.toFixed(1)}</span>
            </div>
            <div className="heat-slider-container">
              <span className="heat-icon cold">❄️</span>
              <input type="range" min="0" max="1" step="0.1" value={debateTemperature} onChange={(e) => setDebateTemperature(parseFloat(e.target.value))} className="heat-slider" />
              <span className="heat-icon hot">🔥</span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
