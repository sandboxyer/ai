class ChatView {
    static Html() {
      return String.raw`
      <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
      <title>EasyAI</title>
      <style>
          /* ---------- Tokens ---------- */
          :root {
              --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
              --bg: #f6f7f9;
              --surface: #ffffff;
              --surface-2: #f2f3f6;
              --border: #e7e9ee;
              --text: #14161a;
              --muted: #7d838f;
              --accent: #0a84ff;
              --accent-hover: #0071e3;
              --ai-bubble: #f2f3f6;
              --shadow-sm: 0 1px 2px rgba(16, 20, 28, .05);
              --shadow-md: 0 8px 24px rgba(16, 20, 28, .12);
          }

          /* ---------- Base ---------- */
          *, *::before, *::after {
              box-sizing: border-box;
          }
          html, body {
              height: 100%;
              margin: 0;
          }
          body {
              font-family: var(--font-ui);
              font-size: 15px;
              line-height: 1.55;
              color: var(--text);
              background: var(--bg);
              -webkit-font-smoothing: antialiased;
              -moz-osx-font-smoothing: grayscale;
          }
          button {
              font-family: inherit;
          }
          :focus-visible {
              outline: 2px solid rgba(10, 132, 255, .5);
              outline-offset: 2px;
          }
          ::-webkit-scrollbar {
              width: 10px;
              height: 10px;
          }
          ::-webkit-scrollbar-track {
              background: transparent;
          }
          ::-webkit-scrollbar-thumb {
              background: rgba(20, 22, 26, .16);
              border: 3px solid transparent;
              border-radius: 99px;
              background-clip: content-box;
          }
          ::-webkit-scrollbar-thumb:hover {
              background: rgba(20, 22, 26, .3);
              background-clip: content-box;
          }

          /* ---------- Layout ---------- */
          .container {
              display: flex;
              height: 100%;
              height: 100dvh;
              background: var(--surface);
              overflow: hidden;
          }

          /* ---------- Sessions sidebar ---------- */
          .chat-list {
              flex: 0 0 264px;
              width: 264px;
              display: flex;
              flex-direction: column;
              gap: 8px;
              padding: 18px 14px;
              background: var(--surface-2);
              border-right: 1px solid var(--border);
              overflow-y: auto;
              overscroll-behavior: contain;
          }
          .chat-list h2 {
              margin: 2px 0 4px;
              padding: 0 6px;
              font-size: 11px;
              font-weight: 600;
              letter-spacing: .12em;
              text-transform: uppercase;
              color: var(--muted);
          }
          .session-list {
              display: flex;
              flex-direction: column;
              gap: 2px;
          }
          .session-item {
              display: flex;
              align-items: center;
              gap: 9px;
              width: 100%;
              padding: 9px 10px;
              border: 1px solid transparent;
              border-radius: 10px;
              background: transparent;
              color: var(--text);
              font-size: 13.5px;
              text-align: left;
              cursor: pointer;
              overflow: hidden;
              white-space: nowrap;
              text-overflow: ellipsis;
              transition: background-color .16s ease, border-color .16s ease, box-shadow .16s ease;
          }
          .session-item:hover {
              background: rgba(20, 22, 26, .05);
          }
          .session-item.active {
              background: var(--surface);
              border-color: var(--border);
              box-shadow: var(--shadow-sm);
              font-weight: 500;
          }
          .session-dot {
              flex: 0 0 auto;
              width: 7px;
              height: 7px;
              border-radius: 50%;
              background: var(--accent);
              box-shadow: 0 0 0 3px rgba(10, 132, 255, .14);
          }
          .session-name {
              overflow: hidden;
              text-overflow: ellipsis;
          }
          .new-session-btn {
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
              width: 100%;
              margin-top: auto;
              padding: 10px 12px;
              border: 1px solid var(--border);
              border-radius: 11px;
              background: var(--surface);
              color: var(--text);
              font-size: 13.5px;
              font-weight: 500;
              cursor: pointer;
              box-shadow: var(--shadow-sm);
              transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
          }
          .new-session-btn:hover {
              border-color: #d9dce3;
              box-shadow: 0 6px 16px rgba(16, 20, 28, .1);
              transform: translateY(-1px);
          }
          .new-session-btn:active {
              transform: translateY(0);
          }
          .new-session-btn .plus {
              font-size: 15px;
              font-weight: 600;
              line-height: 1;
              color: var(--accent);
          }

          /* ---------- Chat shell ---------- */
          .chat-box {
              position: relative;
              flex: 1 1 auto;
              min-width: 0;
              display: flex;
              flex-direction: column;
              background: var(--surface);
          }
          .chat-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
              padding: 13px 24px;
              border-bottom: 1px solid var(--border);
              background: rgba(255, 255, 255, .86);
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px);
              z-index: 5;
          }
          .chat-title {
              margin: 0;
              font-size: 14px;
              font-weight: 600;
          }
          .reset-button {
              padding: 7px 14px;
              border: 1px solid var(--border);
              border-radius: 9px;
              background: var(--surface);
              color: var(--muted);
              font-size: 12.5px;
              font-weight: 500;
              cursor: pointer;
              transition: color .16s ease, border-color .16s ease, background-color .16s ease;
          }
          .reset-button:hover {
              color: #d0342c;
              border-color: rgba(208, 52, 44, .35);
              background: rgba(208, 52, 44, .06);
          }

          /* ---------- Messages ---------- */
          #chat-messages {
              flex: 1 1 auto;
              min-height: 0;
              display: flex;
              flex-direction: column;
              gap: 14px;
              padding: 24px max(24px, calc((100% - 880px) / 2)) 32px;
              overflow-y: auto;
              overscroll-behavior: contain;
              scrollbar-gutter: stable;
          }
          .message {
              position: relative;
              max-width: 100%;
              padding: 12px 16px 30px;
              border-radius: 16px;
              white-space: pre-wrap;
              overflow-wrap: anywhere;
              word-break: break-word;
              animation: message-in .2s ease-out both;
          }
          @keyframes message-in {
              from {
                  opacity: 0;
                  transform: translateY(6px);
              }
              to {
                  opacity: 1;
                  transform: none;
              }
          }
          .user-message {
              align-self: flex-end;
              background: var(--accent);
              color: #ffffff;
              border-bottom-right-radius: 6px;
              box-shadow: 0 2px 10px rgba(10, 132, 255, .22);
          }
          .ai-message {
              align-self: flex-start;
              background: var(--ai-bubble);
              color: var(--text);
              border-bottom-left-radius: 6px;
          }

          /* ---------- Composer ---------- */
          .message-input {
              display: flex;
              align-items: flex-end;
              gap: 10px;
              padding: 14px 20px calc(14px + env(safe-area-inset-bottom, 0px));
              background: var(--surface);
              border-top: 1px solid var(--border);
          }
          .message-input textarea {
              flex: 1 1 auto;
              min-width: 0;
              min-height: 46px;
              max-height: 190px;
              padding: 12px 15px;
              border: 1px solid var(--border);
              border-radius: 14px;
              background: var(--surface-2);
              color: var(--text);
              font-family: inherit;
              font-size: 15px;
              line-height: 1.4;
              resize: none;
              outline: none;
              transition: background-color .16s ease, border-color .16s ease, box-shadow .16s ease;
          }
          .message-input textarea::placeholder {
              color: var(--muted);
          }
          .message-input textarea:focus {
              background: var(--surface);
              border-color: rgba(10, 132, 255, .55);
              box-shadow: 0 0 0 3px rgba(10, 132, 255, .12);
          }
          .message-input textarea:disabled {
              opacity: .6;
          }
          .message-input button {
              flex: 0 0 auto;
              height: 46px;
              padding: 0 22px;
              border: none;
              border-radius: 14px;
              background: var(--accent);
              color: #ffffff;
              font-size: 14px;
              font-weight: 600;
              cursor: pointer;
              box-shadow: 0 2px 10px rgba(10, 132, 255, .24);
              transition: background-color .16s ease, transform .12s ease, box-shadow .16s ease;
          }
          .message-input button:hover {
              background: var(--accent-hover);
              box-shadow: 0 4px 16px rgba(10, 132, 255, .32);
          }
          .message-input button:active {
              transform: scale(.98);
          }
          
          /* ---------- Per-bubble copy button ---------- */
          .message {
              --copy-bg: rgba(20, 22, 26, .06);
              --copy-bg-hover: rgba(20, 22, 26, .12);
              --copy-color: #5f6673;
          }
          .user-message {
              --copy-bg: rgba(255, 255, 255, .18);
              --copy-bg-hover: rgba(255, 255, 255, .32);
              --copy-color: #ffffff;
          }
          .message-copy-button {
              position: absolute;
              right: 8px;
              bottom: 7px;
              display: inline-flex;
              align-items: center;
              padding: 3px 9px;
              border: none;
              border-radius: 7px;
              background: var(--copy-bg, rgba(20, 22, 26, .06));
              color: var(--copy-color, #5f6673);
              font-family: inherit;
              font-size: 11px;
              font-weight: 500;
              line-height: 1.5;
              cursor: pointer;
              opacity: 0;
              transform: translateY(2px);
              transition: opacity .16s ease, transform .16s ease, background-color .16s ease, color .16s ease;
              z-index: 5;
          }
          .message:hover .message-copy-button,
          .message:focus-within .message-copy-button {
              opacity: 1;
              transform: none;
          }
          .message-copy-button:hover {
              background: var(--copy-bg-hover, rgba(20, 22, 26, .12));
          }
          .message-copy-button.copied {
              background: #34c759;
              color: #ffffff;
              opacity: 1;
              transform: none;
          }
          @media (hover: none) {
              .message-copy-button {
                  opacity: .9;
                  transform: none;
              }
          }
          
          /* ---------- Code blocks ---------- */
          .code-block {
              margin: 12px 0 6px;
              border-radius: 12px;
              background: #10131a;
              color: #d6dbe4;
              font-family: var(--font-mono);
              border: 1px solid rgba(255, 255, 255, .07);
              overflow: hidden;
              box-shadow: 0 8px 22px rgba(16, 19, 26, .18);
          }
          .code-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 10px;
              background: rgba(255, 255, 255, .045);
              padding: 7px 8px 7px 14px;
              border-bottom: 1px solid rgba(255, 255, 255, .07);
              position: sticky;
              top: 0;
              z-index: 2;
          }
  
          .code-language-label {
              color: #7b8494;
              font-size: 10.5px;
              font-family: var(--font-ui);
              font-weight: 600;
              letter-spacing: .1em;
              text-transform: uppercase;
          }
  
          .code-content {
              padding: 14px 16px 16px;
              margin: 0;
              overflow-x: auto;
              white-space: pre-wrap;
              overflow-wrap: anywhere;
              background: transparent;
              color: #d6dbe4;
              border: none;
              font-family: inherit;
              font-size: 13px;
              line-height: 1.65;
              border-radius: 0;
          }
          .code-content::-webkit-scrollbar-thumb {
              background: rgba(255, 255, 255, .18);
              background-clip: content-box;
          }
          .code-content::-webkit-scrollbar-thumb:hover {
              background: rgba(255, 255, 255, .3);
              background-clip: content-box;
          }
  
          .copy-button {
              flex-shrink: 0;
              padding: 4px 10px;
              border: 1px solid rgba(255, 255, 255, .14);
              border-radius: 7px;
              background: rgba(255, 255, 255, .06);
              color: #c9cfda;
              font-family: var(--font-ui);
              font-size: 11px;
              font-weight: 500;
              line-height: 1.5;
              cursor: pointer;
              transition: background-color .16s ease, color .16s ease, border-color .16s ease;
          }
          .copy-button:hover {
              background: rgba(255, 255, 255, .14);
              color: #ffffff;
          }
          .copy-button.copied {
              background: #34c759;
              border-color: #34c759;
              color: #ffffff;
          }
          /* ---------- Scroll to bottom ---------- */
          .scroll-to-bottom {
              position: absolute;
              right: 24px;
              bottom: 96px;
              display: none;
              align-items: center;
              justify-content: center;
              width: 38px;
              height: 38px;
              padding: 0;
              border: 1px solid var(--border);
              border-radius: 50%;
              background: rgba(255, 255, 255, .92);
              backdrop-filter: blur(10px);
              -webkit-backdrop-filter: blur(10px);
              color: var(--text);
              font-size: 11px;
              line-height: 1;
              cursor: pointer;
              box-shadow: var(--shadow-md);
              z-index: 20;
              transition: transform .16s ease, box-shadow .16s ease, background-color .16s ease;
          }
          .scroll-to-bottom:hover {
              transform: translateY(-2px);
              box-shadow: 0 12px 26px rgba(16, 20, 28, .16);
          }
          .scroll-to-bottom.visible {
              display: flex;
          }

          /* ---------- Motion / responsive ---------- */
          @media (prefers-reduced-motion: reduce) {
              .message {
                  animation: none;
              }
              .scroll-to-bottom {
                  transition: none;
              }
          }
          @media (max-width: 820px) {
              .container {
                  flex-direction: column;
              }
              .chat-list {
                  flex: 0 0 auto;
                  width: 100%;
                  flex-direction: row;
                  align-items: center;
                  gap: 10px;
                  padding: 10px 12px;
                  border-right: none;
                  border-bottom: 1px solid var(--border);
                  overflow-x: auto;
                  overflow-y: hidden;
              }
              .chat-list::-webkit-scrollbar {
                  display: none;
              }
              .chat-list h2 {
                  display: none;
              }
              .session-list {
                  flex: 0 0 auto;
                  flex-direction: row;
              }
              .session-item {
                  width: auto;
                  flex: 0 0 auto;
              }
              .new-session-btn {
                  flex: 0 0 auto;
                  width: auto;
                  margin-top: 0;
                  padding: 8px 12px;
              }
              .chat-header {
                  padding: 12px 16px;
              }
              #chat-messages {
                  gap: 12px;
                  padding: 16px 14px 24px;
              }
              .message {
                  padding: 11px 14px 29px;
                  border-radius: 15px;
              }
              .message-input {
                  gap: 8px;
                  padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
              }
              .message-input textarea {
                  min-height: 44px;
                  padding: 11px 14px;
                  border-radius: 13px;
              }
              .message-input button {
                  height: 44px;
                  padding: 0 16px;
                  border-radius: 13px;
              }
              .code-content {
                  font-size: 12.5px;
              }
              .scroll-to-bottom {
                  right: 14px;
                  bottom: 88px;
                  width: 36px;
                  height: 36px;
              }
          }
          @media (max-width: 480px) {
              .message-input button {
                  padding: 0 14px;
              }
          }
      </style>
  </head>
  <body>
      <div class="container">
          <aside class="chat-list">
              <h2>Sessions</h2>
              <div class="session-list" id="session-list">
                  <button class="session-item active" type="button" title="Current session">
                      <span class="session-dot"></span>
                      <span class="session-name">Current chat</span>
                  </button>
              </div>
              <button class="new-session-btn" type="button" onclick="newSession()">
                  <span class="plus">+</span>
                  <span>New session</span>
              </button>
          </aside>
          <main class="chat-box">
              <header class="chat-header">
                  <h2 class="chat-title">Chat</h2>
                  <button class="reset-button" onclick="resetChat()" title="Clear this conversation">Reset</button>
              </header>
              <div id="chat-messages">
                  </div>
              <div class="message-input">
                  <textarea id="message-input" placeholder="Type a message..." onkeydown="handleInput(event)"></textarea>
                  <button onclick="sendMessage()">Send</button>
              </div>
              <button class="scroll-to-bottom" id="scrollToBottomBtn" onclick="scrollToBottom()" title="Scroll to bottom">▼</button>
          </main>
      </div>
  
      <script>
          let eventSource = null;
          let aiMessageDiv = null;
          let isGenerating = false;
          let isAutoScrollLocked = true;
          let aiFullContent = '';
          
          let messageContentMap = new Map();
          
          const chatMessages = document.getElementById('chat-messages');
          const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');
          
          chatMessages.addEventListener('scroll', function() {
              const scrollBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight;
              const isAtBottom = scrollBottom < 30;
              
              if (isGenerating) {
                  if (isAtBottom && !isAutoScrollLocked) {
                      isAutoScrollLocked = true;
                      scrollToBottomBtn.classList.remove('visible');
                  } else if (!isAtBottom && isAutoScrollLocked) {
                      isAutoScrollLocked = false;
                      scrollToBottomBtn.classList.add('visible');
                  }
              } else {
                  if (!isAtBottom) {
                      scrollToBottomBtn.classList.add('visible');
                  } else {
                      scrollToBottomBtn.classList.remove('visible');
                  }
              }
          });
          
          function scrollToBottom() {
              requestAnimationFrame(function() {
                  chatMessages.scrollTop = chatMessages.scrollHeight;
                  isAutoScrollLocked = true;
                  scrollToBottomBtn.classList.remove('visible');
              });
          }
          
          function addMessageCopyButton(messageDiv, originalContent) {
              const copyButton = document.createElement('button');
              copyButton.className = 'message-copy-button';
              copyButton.textContent = 'Copy';
              copyButton.onclick = function(e) {
                  e.stopPropagation();
                  const contentToCopy = originalContent || messageDiv.innerText || messageDiv.textContent;
                  navigator.clipboard.writeText(contentToCopy).then(function() {
                      copyButton.textContent = 'Copied!';
                      copyButton.classList.add('copied');
                      setTimeout(function() {
                          copyButton.textContent = 'Copy';
                          copyButton.classList.remove('copied');
                      }, 2000);
                  });
              };
              messageDiv.appendChild(copyButton);
          }
          
          function detectAndFormatCode(text) {
              const fragments = [];
              let currentIndex = 0;
              const backtick3 = '\x60\x60\x60';
              
              while (currentIndex < text.length) {
                  const codeBlockStart = text.indexOf(backtick3, currentIndex);
                  
                  if (codeBlockStart === -1) {
                      if (currentIndex < text.length) {
                          fragments.push({
                              type: 'text',
                              content: text.substring(currentIndex)
                          });
                      }
                      break;
                  }
                  
                  if (codeBlockStart > currentIndex) {
                      fragments.push({
                          type: 'text',
                          content: text.substring(currentIndex, codeBlockStart)
                      });
                  }
                  
                  const lineEnd = text.indexOf('\n', codeBlockStart);
                  let language = '';
                  let codeStartIndex;
                  
                  if (lineEnd !== -1) {
                      const possibleLang = text.substring(codeBlockStart + 3, lineEnd).trim();
                      if (/^[a-zA-Z0-9#\-\+_.]*$/.test(possibleLang) && possibleLang.length < 30) {
                          language = possibleLang;
                          codeStartIndex = lineEnd + 1;
                      } else {
                          codeStartIndex = codeBlockStart + 3;
                          if (text[codeStartIndex] === '\n') {
                              codeStartIndex++;
                          }
                      }
                  } else {
                      codeStartIndex = codeBlockStart + 3;
                  }
                  
                  // Find the closing fence intelligently
                  let codeBlockEnd = -1;
                  let searchIndex = codeStartIndex;
                  
                  while (searchIndex < text.length) {
                      const potentialEnd = text.indexOf(backtick3, searchIndex);
                      if (potentialEnd === -1) {
                          break;
                      }
                      
                      // Check if this is a proper closing fence (at start of line)
                      const lineStart = text.lastIndexOf('\n', potentialEnd - 1);
                      const beforeFence = text.substring(lineStart + 1, potentialEnd);
                      
                      if (/^\s*$/.test(beforeFence)) {
                          const afterFence = text.substring(potentialEnd + 3, potentialEnd + 4);
                          
                          if (afterFence === '' || afterFence === '\n' || afterFence === '\r') {
                              codeBlockEnd = potentialEnd;
                              break;
                          }
                      }
                      
                      searchIndex = potentialEnd + 3;
                  }
                  
                  if (codeBlockEnd === -1) {
                      fragments.push({
                          type: 'code',
                          language: language || 'code',
                          content: text.substring(codeStartIndex),
                          isComplete: false
                      });
                      break;
                  }
                  
                  let codeContent = text.substring(codeStartIndex, codeBlockEnd);
                  
                  if (codeContent.endsWith('\n')) {
                      codeContent = codeContent.slice(0, -1);
                  }
                  
                  fragments.push({
                      type: 'code',
                      language: language || 'code',
                      content: codeContent,
                      isComplete: true
                  });
                  
                  currentIndex = codeBlockEnd + 3;
                  
                  if (currentIndex < text.length && text[currentIndex] === '\n') {
                      currentIndex++;
                  }
              }
              
              return fragments.length > 0 ? fragments : [{ type: 'text', content: text }];
          }
          
          function renderMessageContent(messageDiv, content) {
              messageDiv.innerHTML = '';
              
              const fragments = detectAndFormatCode(content);
              
              fragments.forEach(function(fragment) {
                  if (fragment.type === 'code') {
                      const codeBlock = document.createElement('div');
                      codeBlock.className = 'code-block';
                      
                      const header = document.createElement('div');
                      header.className = 'code-header';
                      
                      const langLabel = document.createElement('span');
                      langLabel.className = 'code-language-label';
                      langLabel.textContent = fragment.language || 'code';
                      header.appendChild(langLabel);
                      
                      const copyButton = document.createElement('button');
                      copyButton.className = 'copy-button';
                      copyButton.textContent = 'Copy';
                      copyButton.onclick = function() {
                          navigator.clipboard.writeText(fragment.content).then(function() {
                              copyButton.textContent = 'Copied!';
                              copyButton.classList.add('copied');
                              setTimeout(function() {
                                  copyButton.textContent = 'Copy';
                                  copyButton.classList.remove('copied');
                              }, 2000);
                          });
                      };
                      header.appendChild(copyButton);
                      codeBlock.appendChild(header);
                      
                      const pre = document.createElement('pre');
                      pre.className = 'code-content';
                      const code = document.createElement('code');
                      code.textContent = fragment.content;
                      pre.appendChild(code);
                      codeBlock.appendChild(pre);
                      
                      messageDiv.appendChild(codeBlock);
                  } else {
                      const textNode = document.createTextNode(fragment.content);
                      messageDiv.appendChild(textNode);
                  }
              });
              
              addMessageCopyButton(messageDiv, content);
          }
          
          function sendMessage() {
            if (isGenerating) return;
            
            const input = document.getElementById('message-input');
            const message = input.value.trim();
            if (!message) return;
            
            appendMessage(message, 'user');
            input.value = '';
            input.disabled = true;
            isGenerating = true;
            isAutoScrollLocked = true;
            aiFullContent = '';
            scrollToBottomBtn.classList.remove('visible');
            
            if (eventSource) {
              eventSource.close();
            }
            
            fetch('/message', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ message: message })
            })
            .then(function(response) {
              const reader = response.body.getReader();
              const decoder = new TextDecoder();
              
              function processStream(result) {
                if (result.done) {
                  isGenerating = false;
                  input.disabled = false;
                  input.focus();
                  aiMessageDiv = null;
                  aiFullContent = '';
                  if (isAutoScrollLocked) {
                      scrollToBottom();
                  }
                  return;
                }
                
                const chunk = decoder.decode(result.value, { stream: true });
                const lines = chunk.split('\n\n');
                
                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i];
                  if (line.startsWith('data: ')) {
                    const data = line.substring(6);
                    
                    if (data === '[DONE]') {
                      isGenerating = false;
                      input.disabled = false;
                      input.focus();
                      aiMessageDiv = null;
                      aiFullContent = '';
                      if (isAutoScrollLocked) {
                          scrollToBottom();
                      }
                      return;
                    }
                    
                    try {
                      const parsed = JSON.parse(data);
                      if (parsed.content) {
                        const contentWithLineBreaks = parsed.content.replace(/\\n/g, '\n');
                        aiFullContent += contentWithLineBreaks;
                        
                        if (aiMessageDiv) {
                          renderMessageContent(aiMessageDiv, aiFullContent);
                        } else {
                          aiMessageDiv = document.createElement('div');
                          aiMessageDiv.classList.add('message', 'ai-message');
                          chatMessages.appendChild(aiMessageDiv);
                          renderMessageContent(aiMessageDiv, aiFullContent);
                        }
                        
                        if (isAutoScrollLocked) {
                          scrollToBottom();
                        }
                      }
                    } catch (e) {
                      console.error('Error parsing JSON:', e, 'Data:', data);
                    }
                  }
                }
                
                return reader.read().then(processStream);
              }
              
              return reader.read().then(processStream);
            })
            .catch(function(error) {
              console.error('Error:', error);
              isGenerating = false;
              input.disabled = false;
              input.focus();
            });
          }
          
          function resetChat() {
            fetch('/reset', { method: 'POST' });
            document.getElementById('chat-messages').innerHTML = '';
            aiMessageDiv = null;
            aiFullContent = '';
            isAutoScrollLocked = true;
            scrollToBottomBtn.classList.remove('visible');
          }
          
          function appendMessage(text, sender) {
            const chatMessages = document.getElementById('chat-messages');
            if (sender === 'user') {
              const msgDiv = document.createElement('div');
              msgDiv.classList.add('message', 'user-message');
              msgDiv.textContent = text;
              chatMessages.appendChild(msgDiv);
              addMessageCopyButton(msgDiv, text);
              scrollToBottom();
            }
          }
          
          function handleInput(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          }
          
          window.onload = function() {
            const input = document.getElementById('message-input');
            input.addEventListener('keydown', handleInput);
            input.focus();
          };
      </script>
          
      <script>
          // --- Sessions (placeholder) ---
          // Creating a new session is simply a page refresh for now.
          function newSession() {
              window.location.reload();
          }

          // Keep the active session highlighted (only the current one exists for now).
          (function () {
              var items = document.querySelectorAll('.session-item');
              items.forEach(function (item) {
                  item.addEventListener('click', function () {
                      items.forEach(function (el) {
                          el.classList.remove('active');
                      });
                      item.classList.add('active');
                  });
              });
          })();
      </script>

  </body>
  </html>
      `;
    }
  }
  
  export default ChatView;