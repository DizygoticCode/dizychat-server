/* ==============================
   DIZYCHAT — chat.js (Render-ready, Dizy Purple Edition)
   - Socket.IO only
   - Single paperclip upload (all filetypes)
   - Upload progress (Dizy Purple)
   - Clickable link + inline previews
   - Full history via 'load messages'
   - Console logs kept verbose
   - Tenor/emoji/fusion hooks untouched
   ============================== */

(() => {
  // --- DOM refs ---
  const messagesEl = document.getElementById('messages');
  const formEl = document.getElementById('form');
  const inputEl = document.getElementById('input');
  const emojiBtn = document.getElementById('emoji-btn'); // for positioning only

  // Ensure paperclip button + hidden input exist (do NOT duplicate)
  let attachBtn = document.getElementById('file-attach');
  let fileInput = document.getElementById('file-input');

  if (!attachBtn && formEl) {
    attachBtn = document.createElement('button');
    attachBtn.id = 'file-attach';
    attachBtn.type = 'button';
    attachBtn.title = 'Attach file';
    attachBtn.textContent = '📎';
    if (emojiBtn) formEl.insertBefore(attachBtn, emojiBtn.nextSibling);
    else formEl.appendChild(attachBtn);
  }
  if (!fileInput) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'file-input';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
  }
  fileInput.setAttribute('accept', '*/*'); // allow all types

  // --- state ---
  window.currentUser = window.currentUser || localStorage.getItem('dizy_username') || 'Guest';
  window.currentRoom = window.currentRoom || localStorage.getItem('dizy_room') || 'lobby';

  // --- Socket.IO ---
  const socket = (window.socket = window.socket || io());
  console.log('[Socket] init', { user: window.currentUser, room: window.currentRoom });

  function scrollToBottom() {
    try { messagesEl.scrollTop = messagesEl.scrollHeight; } catch {}
  }

  // URL linkify helper (keeps raw text clickable)
  const urlRegex = /((https?:\/\/|www\.)[^\s<]+)/gi;
  function linkify(str) {
    return (str || '').replace(urlRegex, (u) => {
      const url = u.startsWith('http') ? u : `http://${u}`;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${u}</a>`;
    });
  }

  // --- Inline preview from URL or file meta ---
  function createPreviewEl(opts) {
    const { url, typeHint = '', className = '' } = opts || {};
    if (!url) return null;
    const lower = (url.split('?')[0] || '').toLowerCase();
    const hint = (typeHint || '').toLowerCase();

    // Images
    if (hint.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) {
      const img = document.createElement('img');
      img.src = url;
      img.className = className || 'inline-image';
      img.alt = 'image';
      img.style.maxWidth = '280px';
      img.style.borderRadius = '12px';
      img.style.marginTop = '6px';
      img.loading = 'lazy';
      return img;
    }

    // Video
    if (hint.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/.test(lower)) {
      const v = document.createElement('video');
      v.src = url;
      v.controls = true;
      v.className = className || 'inline-video';
      v.style.maxWidth = '320px';
      v.style.borderRadius = '12px';
      v.style.marginTop = '6px';
      return v;
    }

    // Audio
    if (hint.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/.test(lower)) {
      const a = document.createElement('audio');
      a.src = url;
      a.controls = true;
      a.className = className || 'inline-audio';
      a.style.display = 'block';
      a.style.marginTop = '6px';
      return a;
    }

    // PDF (iframe preview)
    if (hint === 'application/pdf' || /\.pdf$/.test(lower)) {
      const f = document.createElement('iframe');
      f.src = url;
      f.className = className || 'inline-pdf';
      f.style.width = '100%';
      f.style.maxWidth = '520px';
      f.style.height = '420px';
      f.style.border = '0';
      f.style.borderRadius = '12px';
      f.style.marginTop = '6px';
      return f;
    }

    // Text files
    if (hint.startsWith('text/') || /\.(txt|csv|md|log)$/.test(lower)) {
      const p = document.createElement('iframe');
      p.src = url;
      p.className = className || 'inline-text';
      p.style.width = '100%';
      p.style.maxWidth = '520px';
      p.style.height = '320px';
      p.style.border = '0';
      p.style.borderRadius = '12px';
      p.style.marginTop = '6px';
      return p;
    }

    // Fallback: no inline preview, caller can still render a link
    return null;
  }

  // --- Render a message bubble ---
  function addMessage(msg) {
    try {
      const wrap = document.createElement('div');
      wrap.className = 'message ' + (msg.user === window.currentUser ? 'self' : 'other');

      const meta = document.createElement('div');
      meta.className = 'meta';
      const when = msg.timestamp ? new Date(msg.timestamp) : new Date();
      meta.textContent = `${msg.user} • ${when.toLocaleTimeString()}`;

      const text = document.createElement('div');
      text.className = 'text';
      text.innerHTML = linkify(msg.text || '');

      // Inline preview for uploaded files
      if (msg.fileUrl) {
        const preview = createPreviewEl({ url: msg.fileUrl, typeHint: msg.fileType || '' });
        if (preview) text.appendChild(preview);
      } else {
        // Also scan message text for direct file links and preview them
        const links = (msg.text || '').match(urlRegex) || [];
        links.forEach((u) => {
          const url = u.startsWith('http') ? u : `http://${u}`;
          const el = createPreviewEl({ url });
          if (el) text.appendChild(el);
        });
      }

      wrap.appendChild(meta);
      wrap.appendChild(text);
      messagesEl.appendChild(wrap);
      scrollToBottom();
    } catch (e) {
      console.log('[addMessage] error', e, msg);
    }
  }

  // --- Bulk history ---
  let historyLoaded = false;
  socket.on('load messages', (arr) => {
    if (historyLoaded && Array.isArray(arr) && arr.length > 0) {
      console.log('[History] already loaded; skipping duplicate payload');
      return;
    }
    console.log('[History] Received', Array.isArray(arr) ? arr.length : 0, 'messages');
    if (Array.isArray(arr)) arr.forEach(addMessage);
    historyLoaded = true;
    scrollToBottom();
  });

  // --- Stream single messages ---
  socket.on('chat message', (msg) => {
    console.log('[Socket] chat message', msg);
    addMessage(msg);
  });

  // misc events (kept for diagnostics)
  socket.on('message status', (s) => console.log('[Socket] message status', s));
  const typingBubble = document.getElementById('typing-bubble');
  socket.on('typing', (users) => {
    if (!typingBubble) return;
    if (users && users.length) {
      typingBubble.textContent = `${users.join(', ')} typing…`;
      typingBubble.classList.add('show');
      typingBubble.classList.remove('hide');
    } else {
      typingBubble.classList.add('hide');
      typingBubble.classList.remove('show');
    }
  });
  socket.on('pinned messages', (list) => console.log('[Socket] pinned messages', list));
  socket.on('message pinned', (m) => console.log('[Socket] message pinned', m));
  socket.on('message unpinned', (m) => console.log('[Socket] message unpinned', m));
  socket.on('message starred', (p) => console.log('[Socket] message starred', p));
  socket.on('message unstarred', (p) => console.log('[Socket] message unstarred', p));
  socket.on('update reactions', (p) => console.log('[Socket] update reactions', p));
  socket.on('toast', (t) => console.log('[Toast]', t?.type, t?.text));
  socket.on('join error', (err) => console.log('[Join] error', err));

  // --- Join room (if not handled elsewhere) ---
  if (window.currentRoom && window.currentUser) {
    console.log('[Join] emitting join room', window.currentRoom, window.currentUser);
    socket.emit('join room', { room: window.currentRoom, username: window.currentUser });
  }

  // --- Send message ---
  if (formEl && inputEl) {
    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = (inputEl.value || '').trim();
      if (!text) return;
      socket.emit('stop typing');
      const msgData = {
        user: window.currentUser,
        room: window.currentRoom,
        text,
        timestamp: new Date().toISOString()
      };
      console.log('[Send]', msgData);
      socket.emit('chat message', msgData);
      inputEl.value = '';
      scrollToBottom();
    });

    // typing indicators
    let typingTimer;
    inputEl.addEventListener('input', () => {
      clearTimeout(typingTimer);
      socket.emit('typing', window.currentUser);
      typingTimer = setTimeout(() => socket.emit('stop typing'), 1200);
    });
  }

  // ===============================
  // 📎 File Upload with Progress Bar + Clickable Link + Inline Preview
  // ===============================
  function uploadWithProgress(file) {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    console.log(`[Upload] Starting: ${file.name} (${file.type || 'unknown'})`);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload');

    // Placeholder message while uploading
    const tempMsg = {
      user: window.currentUser,
      room: window.currentRoom,
      text: `Uploading ${file.name}…`,
      timestamp: new Date().toISOString()
    };
    addMessage(tempMsg);

    // Progress bar (Dizy Purple)
    const barWrap = document.createElement('div');
    barWrap.className = 'upload-progress';
    barWrap.style.width = '100%';
    barWrap.style.maxWidth = '360px';
    barWrap.style.height = '6px';
    barWrap.style.borderRadius = '999px';
    barWrap.style.background = 'rgba(123,47,247,0.15)';
    barWrap.style.margin = '8px auto';

    const bar = document.createElement('div');
    bar.className = 'upload-bar';
    bar.style.height = '100%';
    bar.style.width = '0%';
    bar.style.borderRadius = '999px';
    bar.style.background = '#7B2FF7';
    bar.style.boxShadow = '0 0 12px rgba(123,47,247,0.6) inset';
    bar.style.transition = 'width .12s linear';

    barWrap.appendChild(bar);
    messagesEl.appendChild(barWrap);
    scrollToBottom();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        bar.style.width = pct + '%';
        if (pct % 10 === 0) console.log(`[Upload] ${pct}% ${file.name}`);
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        const url = data.url;
        if (!url) {
          console.error('[Upload] No URL in response:', data);
          barWrap.remove();
          return;
        }
        console.log('[Upload] Done:', url);

        // Final message with clickable link + inline preview support
        const msgData = {
          user: window.currentUser,
          room: window.currentRoom,
          text: `<a href="${url}" target="_blank" class="file-link">${file.name}</a>`,
          timestamp: new Date().toISOString(),
          fileUrl: url,
          fileType: file.type || ''
        };
        socket.emit('chat message', msgData);
      } catch (err) {
        console.error('[Upload] Parse error:', err);
      } finally {
        barWrap.remove();
      }
    };

    xhr.onerror = () => {
      console.error('[Upload] Failed:', xhr.statusText);
      barWrap.remove();
    };

    xhr.send(formData);
  }

  // Paperclip triggers file dialog
  attachBtn && attachBtn.addEventListener('click', () => fileInput && fileInput.click());
  // When a file is picked
  fileInput && fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    uploadWithProgress(f);
    // allow reselecting same filename immediately
    fileInput.value = '';
  });

  // expose helpers if needed elsewhere
  window.addMessage = window.addMessage || addMessage;
  window.scrollToBottom = window.scrollToBottom || scrollToBottom;

  console.log('[chat.js] ready');
})();
