import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { getModelVisuals, getShortModelName } from '../utils/modelHelpers';
import './DebateView.css';

export default function DebateView({ entries, summary, loading, onInterject, isDebateActive }) {
  const [interjectionText, setInterjectionText] = useState('');
  const [showInterjection, setShowInterjection] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, summary, loading]);

  const handleInterject = (e) => {
    e.preventDefault();
    if (interjectionText.trim() && onInterject) {
      onInterject(interjectionText);
      setInterjectionText('');
      setShowInterjection(false);
    }
  };

  if (!entries || entries.length === 0) {
    if (loading?.active) {
      return (
        <div className="debate-view">
          <div className="debate-loading">
            <div className="spinner"></div>
            <span>Starting debate...</span>
          </div>
        </div>
      );
    }
    return null;
  }

  let currentRound = 0;

  return (
    <div className="debate-view">
      {entries.map((entry, index) => {
        if (entry.type === 'turn') {
          const isNewRound = entry.round !== currentRound;
          currentRound = entry.round;
          const visuals = getModelVisuals(entry.model);
          const shortName = getShortModelName(entry.model);

          return (
            <div key={index}>
              {isNewRound && (
                <div className="debate-round-divider">
                  <span className="round-label">Round {entry.round}</span>
                </div>
              )}
              <div className="debate-turn">
                <div className="turn-header">
                  <div className="turn-identity">
                    <span className="turn-avatar" style={{ background: visuals.gradient }}>
                      {visuals.icon}
                    </span>
                    <div className="turn-meta">
                      <span className="turn-role">{entry.role}</span>
                      <span className="turn-model">{shortName}</span>
                    </div>
                  </div>
                </div>
                <div className="turn-content">
                  <div className="markdown-content">
                    <ReactMarkdown>
                      {typeof entry.response === 'string' ? entry.response : String(entry.response || '')}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        if (entry.type === 'interjection') {
          return (
            <div key={index} className="debate-interjection">
              <div className="interjection-header">
                <span className="interjection-icon">💬</span>
                <span className="interjection-label">Your Direction</span>
              </div>
              <div className="interjection-content">{entry.content}</div>
            </div>
          );
        }

        return null;
      })}

      {loading?.active && loading.currentModel && (
        <div className="debate-turn thinking">
          <div className="turn-header">
            <div className="turn-identity">
              <span className="turn-avatar thinking-pulse">
                <div className="spinner small"></div>
              </span>
              <div className="turn-meta">
                <span className="turn-role">{loading.currentRole || 'Thinking'}</span>
                <span className="turn-model">{getShortModelName(loading.currentModel)}</span>
              </div>
            </div>
          </div>
          <div className="turn-content">
            <div className="thinking-dots">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>
      )}

      {loading?.convergence && (
        <div className="debate-convergence">
          <span className="convergence-icon">🔄</span>
          <span>Checking agreement level...</span>
        </div>
      )}

      {loading?.summary && (
        <div className="debate-summary-loading">
          <div className="spinner"></div>
          <span>Chairman generating summary...</span>
        </div>
      )}

      {summary && (
        <div className="debate-summary">
          <div className="summary-header">
            <span className="summary-icon">📋</span>
            <span className="summary-label">Final Summary</span>
            <span className="summary-model">{getShortModelName(summary.model)}</span>
          </div>
          <div className="summary-content">
            <div className="markdown-content">
              <ReactMarkdown>
                {typeof summary.response === 'string' ? summary.response : String(summary.response || '')}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}

      {isDebateActive && !loading?.summary && (
        <div className="interjection-area">
          {showInterjection ? (
            <form className="interjection-form" onSubmit={handleInterject}>
              <textarea
                className="interjection-input"
                placeholder="Steer the debate... (e.g., 'Focus more on email subject lines')"
                value={interjectionText}
                onChange={(e) => setInterjectionText(e.target.value)}
                rows={2}
                autoFocus
              />
              <div className="interjection-actions">
                <button type="button" className="interjection-cancel" onClick={() => { setShowInterjection(false); setInterjectionText(''); }}>
                  Cancel
                </button>
                <button type="submit" className="interjection-send" disabled={!interjectionText.trim()}>
                  Send Direction
                </button>
              </div>
            </form>
          ) : (
            <button className="interjection-trigger" onClick={() => setShowInterjection(true)}>
              💬 Jump in &amp; steer the debate
            </button>
          )}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

export function ChatResponseView({ response }) {
  if (!response) return null;
  const visuals = getModelVisuals(response.model);
  const shortName = getShortModelName(response.model);

  return (
    <div className="debate-view">
      <div className="debate-turn">
        <div className="turn-header">
          <div className="turn-identity">
            <span className="turn-avatar" style={{ background: visuals.gradient }}>
              {visuals.icon}
            </span>
            <div className="turn-meta">
              <span className="turn-role">{response.role}</span>
              <span className="turn-model">{shortName}</span>
            </div>
          </div>
        </div>
        <div className="turn-content">
          <div className="markdown-content">
            <ReactMarkdown>
              {typeof response.response === 'string' ? response.response : String(response.response || '')}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
