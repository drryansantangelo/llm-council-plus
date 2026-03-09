import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SearchContext from './SearchContext';
import DebateView, { ChatResponseView } from './DebateView';
import { api } from '../api';
import './ChatInterface.css';

const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.docx'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const MAX_FILES = 5;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function isImageFile(file) {
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

function isAllowedFile(file) {
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const getShortModelName = (modelId) => {
  if (!modelId) return 'Unknown';
  if (modelId.includes('/')) return modelId.split('/').pop();
  if (modelId.includes(':')) return modelId.split(':').pop();
  return modelId;
};

export default function ChatInterface({
  conversation,
  onSendMessage,
  onAbort,
  onInterject,
  isLoading,
  isDebateActive,
  debateConfigured,
  debateModels = [],
  chairmanModel = null,
  searchProvider = 'duckduckgo',
  onOpenSettings,
  readOnly = false,
  readOnlyBanner = null,
}) {
  const [input, setInput] = useState('');
  const [webSearch, setWebSearch] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sendMode, setSendMode] = useState('debate');
  const [chatModel, setChatModel] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const textareaRef = useRef(null);
  const modelPickerRef = useRef(null);

  const activeModelCount = debateModels.filter(m => m && m.trim()).length;

  useEffect(() => {
    if (chairmanModel && !chatModel) {
      setChatModel(chairmanModel);
    }
  }, [chairmanModel]);

  useEffect(() => {
    if (activeModelCount < 2) {
      setSendMode('chat');
    }
  }, [activeModelCount]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const maxHeight = 200;
    ta.style.height = Math.min(ta.scrollHeight, maxHeight) + 'px';
    ta.style.overflowY = ta.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (!messagesContainerRef.current) return;
    const container = messagesContainerRef.current;
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    if (isNearBottom) {
      scrollToBottom();
    }
  }, [conversation]);

  const addFiles = useCallback((files) => {
    const newFiles = Array.from(files).filter(f => {
      if (!isAllowedFile(f)) return false;
      if (f.size > MAX_FILE_SIZE) return false;
      return true;
    });
    setAttachedFiles(prev => {
      const combined = [...prev, ...newFiles];
      return combined.slice(0, MAX_FILES);
    });
  }, []);

  const removeFile = useCallback((index) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files?.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (!blob) continue;
        const ext = blob.type === 'image/png' ? '.png'
          : blob.type === 'image/jpeg' ? '.jpg'
          : blob.type === 'image/gif' ? '.gif'
          : blob.type === 'image/webp' ? '.webp'
          : '.png';
        const hasProperName = blob.name && blob.name !== 'image.png' && blob.name !== 'blob';
        const name = hasProperName ? blob.name : `screenshot-${Date.now()}${ext}`;
        const file = new File([blob], name, { type: blob.type });
        imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addFiles(imageFiles);
    }
  }, [addFiles]);

  const handleFileSelect = useCallback((e) => {
    if (e.target.files?.length > 0) {
      addFiles(e.target.files);
      e.target.value = '';
    }
  }, [addFiles]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if ((input.trim() || attachedFiles.length > 0) && !isLoading) {
      const effectiveMode = sendMode === 'chat' ? 'chat' : null;
      const effectiveChatModel = sendMode === 'chat' ? (chatModel || chairmanModel) : null;
      onSendMessage(
        input,
        webSearch,
        attachedFiles.length > 0 ? attachedFiles : null,
        effectiveMode,
        effectiveChatModel,
      );
      setInput('');
      setAttachedFiles([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const allModels = [...new Set([
    ...(chairmanModel ? [chairmanModel] : []),
    ...debateModels.filter(m => m && m.trim()),
  ])];

  if (!conversation) {
    return (
      <div className="chat-interface">
        <div className="empty-state">
          <h1>DM Debate <span className="plus-text">Studio</span></h1>
          <p className="hero-message">
            {activeModelCount >= 2
              ? `${activeModelCount} experts ready to debate.`
              : activeModelCount === 1
                ? 'One model configured — chat mode.'
                : 'No models configured yet.'}
            {' '}
            <button className="config-link" onClick={() => onOpenSettings('debate')}>Configure</button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-interface">
      <div className="messages-area" ref={messagesContainerRef}>
        {(!conversation || conversation.messages.length === 0) ? (
          <div className="hero-container">
            <div className="hero-content">
              <h1>DM Debate <span className="text-gradient">Studio</span></h1>
              <p className="hero-subtitle">
                {activeModelCount >= 2
                  ? `${activeModelCount} experts ready to debate.`
                  : activeModelCount === 1
                    ? 'One model configured — chat mode.'
                    : 'No models configured yet.'}
                {' '}
                <button className="config-link" onClick={() => onOpenSettings('debate')}>Configure</button>
              </p>
            </div>
          </div>
        ) : (
          conversation.messages.map((msg, index) => (
            <div key={`${conversation.id}-msg-${index}`} className={`message ${msg.role}`}>
              <div className="message-content">
                {msg.role === 'user' ? (
                  <>
                    {msg.files && msg.files.length > 0 && (
                      <div className="user-attachments">
                        {msg.files.map((file, fi) => (
                          file.type === 'image' ? (
                            <img
                              key={fi}
                              src={api.getFileUrl(conversation.id, file.filename)}
                              alt={file.original_name}
                              className="user-attachment-image"
                              onClick={(e) => {
                                e.target.classList.toggle('enlarged');
                              }}
                            />
                          ) : (
                            <div key={fi} className="user-attachment-doc">
                              <span className="doc-icon">{file.original_name.endsWith('.pdf') ? '📄' : '📝'}</span>
                              <span className="doc-name">{file.original_name}</span>
                            </div>
                          )
                        ))}
                      </div>
                    )}
                    <div className="markdown-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  </>
                ) : (
                  <>
                    {msg.loading?.search && (
                      <div className="stage-loading">
                        <div className="spinner"></div>
                        <span>
                          Searching the web with {
                            searchProvider === 'duckduckgo' ? 'DuckDuckGo' :
                            searchProvider === 'tavily' ? 'Tavily' :
                            searchProvider === 'brave' ? 'Brave' : 'Provider'
                          }...
                        </span>
                      </div>
                    )}

                    {msg.metadata?.search_context && (
                      <SearchContext
                        searchQuery={msg.metadata?.search_query}
                        extractedQuery={msg.metadata?.extracted_query}
                        searchContext={msg.metadata?.search_context}
                      />
                    )}

                    {(msg.mode === 'debate' || msg.debate_entries) && (
                      <DebateView
                        entries={msg.debate_entries}
                        summary={msg.summary}
                        loading={msg.loading}
                        onInterject={onInterject}
                        isDebateActive={isDebateActive && index === conversation.messages.length - 1}
                      />
                    )}

                    {msg.mode === 'chat' && msg.chat_response && (
                      <ChatResponseView response={msg.chat_response} />
                    )}

                    {msg.mode === 'chat' && !msg.chat_response && msg.loading?.active && (
                      <div className="chat-loading">
                        <div className="spinner"></div>
                        <span>Thinking...</span>
                      </div>
                    )}

                    {msg.stage1 && !msg.mode && (
                      <div className="markdown-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.stage3?.response || msg.stage1?.[0]?.response || 'No response'}
                        </ReactMarkdown>
                      </div>
                    )}

                    {msg.aborted && (
                      <div className="aborted-indicator">
                        <span className="aborted-icon">⏹</span>
                        <span className="aborted-text">
                          Generation stopped by user.
                          {msg.debate_entries?.length > 0 && ' Partial results shown above.'}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} style={{ height: '20px' }} />
      </div>

      {readOnly ? (
        readOnlyBanner && (
          <div className="input-area">
            <div className="input-container config-required">
              <span className="config-message">{readOnlyBanner}</span>
            </div>
          </div>
        )
      ) : (
      <div className="input-area">
        {!debateConfigured ? (
          <div className="input-container config-required">
            <span className="config-message">
              No models configured.
              <button className="config-link" onClick={() => onOpenSettings('llm_keys')}>Add API Keys</button>
              <span className="config-separator">then</span>
              <button className="config-link" onClick={() => onOpenSettings('debate')}>Set Up Debate</button>
            </span>
          </div>
        ) : (
          <form
            className={`input-container ${isDragOver ? 'drag-over' : ''}`}
            onSubmit={handleSubmit}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {attachedFiles.length > 0 && (
              <div className="attachment-previews">
                {attachedFiles.map((file, i) => (
                  <div key={i} className="attachment-chip">
                    {isImageFile(file) ? (
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        className="attachment-thumb"
                      />
                    ) : (
                      <span className="attachment-doc-icon">
                        {file.name.endsWith('.pdf') ? '📄' : '📝'}
                      </span>
                    )}
                    <span className="attachment-name" title={file.name}>
                      {file.name.length > 20 ? file.name.slice(0, 17) + '...' : file.name}
                    </span>
                    <span className="attachment-size">{formatFileSize(file.size)}</span>
                    <button
                      type="button"
                      className="attachment-remove"
                      onClick={() => removeFile(i)}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="input-row-mode">
              {activeModelCount >= 2 && (
                <div className="mode-toggle">
                  <button
                    type="button"
                    className={`mode-btn ${sendMode === 'chat' ? 'active' : ''}`}
                    onClick={() => setSendMode('chat')}
                    disabled={isLoading}
                  >
                    Chat
                  </button>
                  <button
                    type="button"
                    className={`mode-btn ${sendMode === 'debate' ? 'active' : ''}`}
                    onClick={() => setSendMode('debate')}
                    disabled={isLoading}
                  >
                    Debate
                  </button>
                </div>
              )}

              {sendMode === 'chat' && (
                <div className="chat-model-picker" ref={modelPickerRef}>
                  <button
                    type="button"
                    className="chat-model-btn"
                    onClick={() => setShowModelPicker(!showModelPicker)}
                    disabled={isLoading}
                    title="Select chat model"
                  >
                    {getShortModelName(chatModel || chairmanModel)}
                  </button>
                  {showModelPicker && (
                    <div className="chat-model-dropdown">
                      {allModels.map(m => (
                        <button
                          key={m}
                          type="button"
                          className={`chat-model-option ${m === (chatModel || chairmanModel) ? 'selected' : ''}`}
                          onClick={() => { setChatModel(m); setShowModelPicker(false); }}
                        >
                          {getShortModelName(m)}
                          {m === chairmanModel && <span className="chairman-badge">chairman</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="input-main-row">
              <label className={`search-toggle ${webSearch ? 'active' : ''}`} title="Toggle Web Search">
                <input
                  type="checkbox"
                  className="search-checkbox"
                  checked={webSearch}
                  onChange={() => setWebSearch(!webSearch)}
                  disabled={isLoading}
                />
                <span className="search-icon">🌐</span>
                {webSearch && <span className="search-label">Search On</span>}
              </label>

              <button
                type="button"
                className={`attach-toggle ${attachedFiles.length > 0 ? 'has-files' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || attachedFiles.length >= MAX_FILES}
                title={attachedFiles.length >= MAX_FILES ? `Max ${MAX_FILES} files` : 'Attach files'}
              >
                <span className="attach-icon">📎</span>
                {attachedFiles.length > 0 && (
                  <span className="attach-count">{attachedFiles.length}</span>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ALLOWED_EXTENSIONS.join(',')}
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />

              <textarea
                ref={textareaRef}
                className="message-input"
                placeholder={isLoading ? "Processing..." : sendMode === 'chat' ? "Chat with the expert..." : "Ask the experts..."}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                disabled={isLoading}
                rows={1}
              />

              {isLoading ? (
                <button type="button" className="send-button stop-button" onClick={onAbort} title="Stop">
                  ⏹
                </button>
              ) : (
                <button type="submit" className="send-button" disabled={!input.trim() && attachedFiles.length === 0}>
                  ➤
                </button>
              )}
            </div>
          </form>
        )}
      </div>
      )}
    </div>
  );
}
