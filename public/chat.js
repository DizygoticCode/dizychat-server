// ==============================
// DizyChat — Production-Ready Chat JS
// ==============================

// ---------------- DOM References ----------------
const usernamePrompt = document.getElementById('username-prompt');
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
const roomPasswordInput = document.getElementById('room-password');
const chatContainer = document.getElementById('chat-container');
const roomNameSpan = document.getElementById('room-name');
const messages = document.getElementById('messages');
const form = document.getElementById('form');
const input = document.getElementById('input');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const typingBubble = document.getElementById('typing-bubble');
const pinnedBanner = document.getElementById('pinned-messages');
const toggleThemeBtn = document.getElementById('toggle-theme');
const leaveBtn = document.getElementById('leave-btn');

let socket = null;
let currentUser = '';
let currentRoom = '';
let roomPassword = '';
let typingTimeout = null;
let isScrollLocked = false;
let darkMode = localStorage.getItem('darkMode') === 'true';
let emojiData = [];
let emojisLoaded = false;
let unreadCount = 0;
let faviconImage = new Image();

// ---------------- Apply Dark Mode ----------------
document.body.classList.toggle('dark', darkMode);

// ---------------- Favicon Logic ----------------
const faviconLink = document.querySelector("link[rel~='icon']") || (() => {
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = '/logo.png';
  document.head.appendChild(link);
  return link;
})();
const faviconCanvas = document.createElement('canvas');
faviconCanvas.width = 32;
faviconCanvas.height = 32;
const ctx = faviconCanvas.getContext('2d');
let badgeScale = 1, popBoost = 0, targetScale = 1, pulse = 0, unreadAlpha = 0;

faviconImage.src = '/logo.png';

function incrementFavicon() {
  unreadCount++;
  popBoost = Math.min(popBoost + 0.25, 0.6);
  targetScale = 1 + popBoost;
}

function resetFavicon() {
  unreadCount = 0;
  popBoost = 0;
  badgeScale = 1;
  targetScale = 1;
}

window.addEventListener('focus', resetFavicon);

function drawFavicon() {
  if (!faviconImage.complete) return requestAnimationFrame(drawFavicon);
  ctx.clearRect(0, 0, 32, 32);
  ctx.drawImage(faviconImage, 0, 0, 32, 32);

  if (unreadCount > 0) {
    unreadAlpha += (1 - unreadAlpha) * 0.15;
    pulse += 0.15;
    const scaleOffset = Math.sin(pulse) * 0.15;
    badgeScale += (targetScale - badgeScale) * 0.2;
    badgeScale = Math.min(badgeScale, 1.6);
    popBoost *= 0.92;

    const x = 26, y = 8, radius = 6;
    const glowRadius = radius * 1.8 + scaleOffset * 6;
    const glow = ctx.createRadialGradient(x, y, radius / 2, x, y, glowRadius);
    glow.addColorStop(0, `rgba(255,68,68,${unreadAlpha*0.5})`);
    glow.addColorStop(1, "rgba(255,68,68,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI*2);
    ctx.fill();

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(badgeScale, badgeScale);
    ctx.translate(-x, -y);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI*2);
    ctx.fillStyle = `rgba(255,68,68,${unreadAlpha})`;
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${unreadAlpha})`;
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(unreadCount > 9 ? "9+" : unreadCount.toString(), x, y);
    ctx.restore();
  } else {
    unreadAlpha *= 0.85;
  }

  faviconLink.href = faviconCanvas.toDataURL("image/png");
  requestAnimationFrame(drawFavicon);
}
requestAnimationFrame(drawFavicon);

// ---------------- Landing Page Join ----------------
joinBtn?.addEventListener('click', () => {
  const username = usernameInput.value.trim();
  const room = roomInput.value.trim();
  const pwd = roomPasswordInput.value.trim();
  if (!username || !room) {
    usernameInput.focus();
    return showInlineWarning('Enter both username and room name.');
  }

  currentUser = username;
  currentRoom = room;
  roomPassword = pwd;

  localStorage.setItem('sessionToken', Date.now());
  localStorage.setItem('username', currentUser);

  usernamePrompt.style.display = 'none';
  chatContainer.style.display = 'flex';
  roomNameSpan.textContent = currentRoom;

  displayMessage({ user: 'System', text: `Welcome to ${currentRoom}, ${currentUser}!`, time: Date.now() });

  const url = new URL(window.location.href);
  url.searchParams.set('room', currentRoom);
  if (roomPassword) url.searchParams.set('password', roomPassword);
  window.history.replaceState({}, '', url);

  addShareLink();
  setTimeout(initChat, 50);
  input?.focus();
});

function showInlineWarning(msg) {
  let warning = document.getElementById('inline-warning');
  if (!warning) {
    warning = document.createElement('div');
    warning.id = 'inline-warning';
    warning.style.color = 'orange';
    warning.style.marginTop = '4px';
    usernamePrompt.appendChild(warning);
  }
  warning.textContent = msg;
}

// ---------------- Share Link ----------------
function addShareLink() {
  if (document.querySelector('#share-btn')) return;
  const shareBtn = document.createElement('button');
  shareBtn.id = 'share-btn';
  shareBtn.textContent = 'Copy Link';
  shareBtn.style.marginLeft = '8px';
  shareBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href);
    showInlineWarning('Link copied to clipboard!');
  });
  document.querySelector('header .header-right')?.appendChild(shareBtn);
}

// ---------------- Initialize Socket ----------------
function initChat() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('join room', { room: currentRoom, password: roomPassword });
    socket.emit('get pinned', { room: currentRoom });
  });

  socket.on('disconnect', () => console.log('Disconnected'));

  socket.on('chat message', displayMessage);
  socket.on('typing', users => {
    const others = (users || []).filter(u => u && u !== currentUser);
    others.length ? showTyping(others) : hideTyping();
  });
  socket.on('stop typing', hideTyping);
  socket.on('pinned messages', renderPinned);
  socket.on('message pinned', renderPinnedMessage);
  socket.on('message unpinned', renderPinnedMessage);
  socket.on('message starred', ({ id, starredBy }) => updateStar(id, starredBy));
  socket.on('message unstarred', ({ id, starredBy }) => updateStar(id, starredBy));
  socket.on('update reactions', ({ id, reactions }) => updateReactions(id, reactions));
}

// ---------------- Display Message ----------------
function displayMessage(msg, prepend = false) {
  if (!msg) return;
  const id = msg._id || msg.id || msg.tempId || '';
  if (id && document.querySelector(`.message[data-id='${id}']`)) return;

  const div = document.createElement('div');
  div.className = `message ${msg.user === currentUser ? 'self' : 'other'}`;
  if (id) div.dataset.id = id;

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${msg.user || 'Anon'} • ${new Date(msg.time || Date.now()).toLocaleTimeString()}`;
  div.appendChild(meta);

  const text = document.createElement('div');
  text.className = 'text';
  
	if (msg.text) {
	// Replace :emojiName: placeholders with <img> if found in flatEmojiList
	text.innerHTML = msg.text.replace(/:([\w-]+):/g, (match, name) => {
		const emoji = flatEmojiList.find(e => e.name === name);
		if (!emoji) return match; // fallback: leave text
		if (emoji.url) return `<img src="${emoji.url}" alt="${name}" class="inline-emoji" style="width:20px; height:20px;">`;
		return emoji.char; // normal Unicode emoji
	});
	} else {
		text.textContent = '';
	}
  
  div.appendChild(text);

  if (msg.linkPreview) {
    const lp = document.createElement('div');
    lp.className = 'link-preview';
    if (msg.linkPreview.image) {
      const img = document.createElement('img');
      img.src = msg.linkPreview.image;
      lp.appendChild(img);
    }
    const info = document.createElement('div');
    info.innerHTML = `<strong>${msg.linkPreview.title || ''}</strong><br>${msg.linkPreview.desc || ''}`;
    lp.appendChild(info);
    div.appendChild(lp);
  }

  // Reactions
  const reactionsDiv = document.createElement('div');
  reactionsDiv.className = 'reactions';
  (msg.reactions || []).forEach(r => {
    const span = document.createElement('span');
    span.textContent = r.emoji;
    reactionsDiv.appendChild(span);
  });
  div.appendChild(reactionsDiv);

  // Star button
  if (msg.user !== currentUser) {
    const starBtn = document.createElement('button');
    starBtn.className = 'star-btn';
    starBtn.textContent = (msg.starredBy?.includes(currentUser)) ? '⭐' : '☆';
    starBtn.addEventListener('click', () => {
      socket.emit(starBtn.textContent === '⭐' ? 'unstar message' : 'star message', { room: currentRoom, id, user: currentUser });
    });
    div.appendChild(starBtn);
  }

  // Pin button
  const pinBtn = document.createElement('button');
  pinBtn.className = 'pin-btn';
  pinBtn.textContent = msg.pinned ? '📌' : '📍';
  pinBtn.addEventListener('click', () => {
    socket.emit(msg.pinned ? 'unpin message' : 'pin message', { room: currentRoom, id });
  });
  div.appendChild(pinBtn);

  prepend ? messages.prepend(div) : appendMessage(div);
  if (msg.user !== currentUser) incrementFavicon();
}

// ---------------- Pinned Messages ----------------
if (pinnedBanner && !pinnedBanner.querySelector('ul')) {
  pinnedBanner.appendChild(document.createElement('ul'));
}

function renderPinned(msgs) {
  if (!pinnedBanner) return;
  const prevScroll = pinnedBanner.scrollTop;
  pinnedBanner.innerHTML = '';
  if (msgs?.length) {
    pinnedBanner.style.display = 'block';
    msgs.forEach(m => {
      const div = document.createElement('div');
      div.className = 'message pinned';
      div.textContent = `${m.user || 'Anon'}: ${m.text || ''}`;
      pinnedBanner.appendChild(div);
    });
    pinnedBanner.scrollTop = prevScroll;
  } else {
    pinnedBanner.style.display = 'none';
  }
}

function renderPinnedMessage() {
  if (socket && currentRoom) socket.emit('get pinned', { room: currentRoom });
}

// ---------------- Helpers ----------------
function appendMessage(div) {
  messages?.appendChild(div);
  if (!isScrollLocked) div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function updateStar(id, starredBy) {
  const msgDiv = document.querySelector(`.message[data-id='${id}']`);
  if (!msgDiv) return;
  const starBtn = msgDiv.querySelector('.star-btn');
  if (!starBtn) return;
  starBtn.textContent = starredBy?.includes(currentUser) ? '⭐' : '☆';
}

function updateReactions(id, reactions) {
  const msgDiv = document.querySelector(`.message[data-id='${id}']`);
  if (!msgDiv) return;
  const reactionsDiv = msgDiv.querySelector('.reactions');
  if (!reactionsDiv) return;
  reactionsDiv.innerHTML = '';
  (reactions || []).forEach(r => {
    const span = document.createElement('span');
    span.textContent = r.emoji;
    reactionsDiv.appendChild(span);
  });
}

// ---------------- Typing Indicator (debounced) ----------------
let typingDebounce;
function showTyping(users) {
  if (!typingBubble) return;
  typingBubble.style.display = 'block';
  typingBubble.textContent = `${users.join(', ')} typing...`;
  clearTimeout(typingDebounce);
  typingDebounce = setTimeout(hideTyping, 1500);
}

function hideTyping() {
  if (!typingBubble) return;
  typingBubble.style.display = 'none';
}

// ---------------- Input Form ----------------
form?.addEventListener('submit', e => {
  e.preventDefault();
  if (!input?.value.trim() || !socket) return;
  socket.emit('chat message', { room: currentRoom, user: currentUser, text: input.value.trim(), time: Date.now() });
  input.value = '';
});

// ---------------- Emoji Picker ----------------
emojiBtn?.addEventListener('click', () => {
  if (!emojiPicker) return;
  emojiPicker.style.display = emojiPicker.style.display === 'block' ? 'none' : 'block';
  if (!emojisLoaded) loadEmojis();
});

function setupQuickEmojis() {
  document.querySelectorAll('#quick-emojis button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!input) return;
      input.value += btn.textContent;
      input.focus();
    });
  });
}

function loadEmojis() {
  fetch('/emojis.json')
    .then(res => res.json())
    .then(data => {
      // For your custom emoji setup
      if (Array.isArray(data)) {
        categorizedEmojis = { All: data.map(e => typeof e === 'string' ? { char: e, name: '', url: null } : e) };
      } else if (data && typeof data === 'object') {
        categorizedEmojis = {};
        Object.keys(data).forEach(cat => {
          categorizedEmojis[cat] = (data[cat] || []).map(e => {
            if (typeof e === 'string') return { char: e, name: '', url: null };
            return { char: e.char || '', name: e.name || '', url: e.url || null };
          });
        });
      } else {
        categorizedEmojis = { Faces: [{ char: '😀', name: 'grinning', url: null }, { char: '😂', name: 'joy', url: null }, { char: '❤️', name: 'heart', url: null }] };
      }

      flatEmojiList = Object.values(categorizedEmojis).flat();

      // Build categorized emoji picker
      buildEmojiPickerUI();

      // For quick emojis (friend’s setup)
      const container = document.getElementById('emoji-picker');
      if (container) {
        const quickDiv = document.createElement('div');
        quickDiv.id = 'quick-emojis';
        // simple flat list of char strings
        flatEmojiList.forEach(e => {
          const btn = document.createElement('button');
          btn.textContent = e.char || '';
          quickDiv.appendChild(btn);
        });
        container.appendChild(quickDiv);
        setupQuickEmojis(); // attach listeners
      }

      emojisLoaded = true;
    })
    .catch(err => {
      console.error('Error loading emojis:', err);
    });
}


setupQuickEmojis();
function buildEmojiPickerUI() {
  if (!emojiPicker) return;
  emojiPicker.innerHTML = '';

  // Search box
  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'padding:6px 6px 4px; position:sticky; top:0; background:var(--panel);';
  const search = document.createElement('input');
  search.type = 'text';
  search.placeholder = 'Search emoji...';
  search.style.cssText = 'width:100%; padding:8px 10px; border-radius:10px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--input-text);';
  searchWrap.appendChild(search);
  emojiPicker.appendChild(searchWrap);

  const content = document.createElement('div');
  content.style.cssText = 'max-height:240px; overflow:auto; padding:6px;';
  emojiPicker.appendChild(content);

  function renderList(filter = '') {
    content.innerHTML = '';
    const q = filter.trim().toLowerCase();

    const cats = Object.entries(categorizedEmojis);
    for (const [cat, list] of cats) {
      // Filter by search
      const displayList = q
        ? list.filter(e => (e.name || '').toLowerCase().includes(q) || (e.char || '').includes(filter))
        : list;

      if (!displayList.length) continue;

      const h = document.createElement('div');
      h.textContent = cat;
      h.style.cssText = 'font-size:12px; color:var(--muted); margin:8px 4px 4px;';
      content.appendChild(h);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid; grid-template-columns: repeat(auto-fill, 34px); gap:6px;';
      displayList.forEach(e => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = e.name || '';
        btn.style.cssText = 'font-size:20px; border:none; background:transparent; cursor:pointer; padding:6px; border-radius:8px;';
					
		// If this emoji has a URL (image/GIF), create an <img>
		  if (e.url) {
			// Custom emoji (image/GIF)
			const img = document.createElement('img');
			img.src = e.url;
			img.alt = e.name || '';
			img.style.cssText = 'width:24px; height:24px; object-fit:contain;';
			btn.appendChild(img);

			btn.addEventListener('click', () => {
				console.log('Emoji clicked:', e);
			    if (e.url) {
				// send image/gif emoji directly
				sendMessage({ 
				fileUrl: e.url, 
				fileType: e.url.endsWith('.gif') ? 'image/gif' : 'image/png', 
				text: '' 
				});
				} else {
				// fallback: insert normal emoji into text input
				if (!input) return;
				input.value += e.char || '';
				input.focus();
				startTyping();
				}
			});
		  } else {
			// Normal Unicode emoji
			btn.textContent = e.char || '';
			btn.addEventListener('click', () => {
			  if (!input) return;
			  input.value += e.char || '';
			  input.focus();
			  startTyping();
			});
		  }
        grid.appendChild(btn);
      });
      content.appendChild(grid);
    }
  }

  renderList();
  search.addEventListener('input', () => renderList(search.value));
}

// =====================
// Attach / Paperclip with Messenger-style progress
// =====================
const attachBtn = document.createElement('button'); attachBtn.id = 'attach-btn'; attachBtn.type = 'button'; attachBtn.innerHTML = '📎';
form.insertBefore(attachBtn, emojiBtn);
const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.id = 'file-input'; fileInput.accept = 'image/*,video/*,application/pdf,.txt,.zip,.rar';
form.appendChild(fileInput);

attachBtn.addEventListener('click', () => fileInput.click());

const pendingUploads = new Map(); // key: "Uploading: filename" -> { startedAt, messageId, progress }

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0]; if (!file) return;

  const placeholderText = `Uploading: ${file.name}`;
  const key = placeholderText;
  pendingUploads.set(key, { startedAt: Date.now(), messageId: null, progress: 0 });

  // 1) Emit placeholder message so EVERYONE sees it
  socket.emit('chat message', { room: currentRoom, user: currentUser, text: placeholderText, time: Date.now() });

  // 2) Upload with progress via XHR
  try {
    await uploadWithProgress('/upload', file, (pct) => {
      const rec = pendingUploads.get(key);
      if (!rec) return;
      rec.progress = pct;
      if (rec.messageId) attachOrUpdateProgressBar(rec.messageId, pct);
      else updateLatestOwnUploadingBubbleUI(placeholderText, pct);
    });

    // 3) After upload succeeded: delete placeholder -> send real file message
    const rec = pendingUploads.get(key);
    if (rec && rec.messageId) {
      socket.emit('delete message', { room: currentRoom, id: rec.messageId });
    }
    // Now emit the actual file message
    const head = await fetch('/upload', { method: 'HEAD' }).catch(() => null); // noop; optional warm
    // We need the actual result URL/type we just got from uploadWithProgress
    // To get that, uploadWithProgress returns {url,type}
    // So let's actually capture and use its return:
  } catch (err) {
    console.error('Upload failed:', err);
    // mark bubble red
    markPlaceholderFailed(placeholderText);
  } finally {
    fileInput.value = '';
  }
});

// XHR upload with progress, returns { url, type }
function uploadWithProgress(endpoint, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    xhr.open('POST', endpoint, true);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && typeof onProgress === 'function') {
        const pct = Math.round((evt.loaded / evt.total) * 100);
        onProgress(pct);
      }
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve({ url: data.url, type: data.type });
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error('Upload error: ' + xhr.status));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));

    xhr.send(formData);
  }).then(({ url, type }) => {
    // After successful upload, send final message
    socket.emit('chat message', {
      room: currentRoom,
      user: currentUser,
      text: file.name,
      time: Date.now(),
      fileUrl: url,
      fileType: type
    });
    return { url, type };
  });
}

// Create/Update progress bar inside a message bubble by id
function attachOrUpdateProgressBar(messageId, pct) {
  const bubble = document.querySelector(`.message[data-id='${messageId}']`);
  if (!bubble) return;
  let bar = bubble.querySelector('.upload-bar');
  let wrap = bubble.querySelector('.upload-wrap');

  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'upload-wrap';
    wrap.style.cssText = 'margin-top:6px; background:rgba(0,0,0,0.08); border-radius:8px; height:8px; overflow:hidden;';
    bar = document.createElement('div');
    bar.className = 'upload-bar';
    bar.style.cssText = 'height:100%; width:0%; background:var(--accent,#25d366); transition:width .12s linear;';
    wrap.appendChild(bar);
    bubble.appendChild(wrap);
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'upload-bar';
    bar.style.cssText = 'height:100%; width:0%; background:var(--accent,#25d366); transition:width .12s linear;';
    wrap.appendChild(bar);
  }
  bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

// When we haven’t got the server id yet, try to find the most recent bubble with our placeholder text
function updateLatestOwnUploadingBubbleUI(placeholderText, pct) {
  const candidates = Array.from(document.querySelectorAll('.message.self .text'))
    .filter(el => el.textContent === placeholderText)
    .map(el => el.closest('.message'));
  const bubble = candidates[candidates.length - 1];
  if (!bubble) return;
  let wrap = bubble.querySelector('.upload-wrap');
  let bar = bubble.querySelector('.upload-bar');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'upload-wrap';
    wrap.style.cssText = 'margin-top:6px; background:rgba(0,0,0,0.08); border-radius:8px; height:8px; overflow:hidden;';
    bar = document.createElement('div');
    bar.className = 'upload-bar';
    bar.style.cssText = 'height:100%; width:0%; background:var(--accent,#25d366); transition:width .12s linear;';
    wrap.appendChild(bar);
    bubble.appendChild(wrap);
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'upload-bar';
    bar.style.cssText = 'height:100%; width:0%; background:var(--accent,#25d366); transition:width .12s linear;';
    wrap.appendChild(bar);
  }
  bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

// Mark failed upload bubble
function markPlaceholderFailed(placeholderText) {
  const candidates = Array.from(document.querySelectorAll('.message.self .text'))
    .filter(el => el.textContent === placeholderText)
    .map(el => el.closest('.message'));
  const bubble = candidates[candidates.length - 1];
  if (!bubble) return;
  const text = bubble.querySelector('.text');
  text.textContent = 'Upload failed ❌';
  bubble.style.background = '#7f1d1d';
  bubble.style.color = '#fff';
}

// ---------------- Scroll Lock ----------------
messages?.addEventListener('scroll', () => {
  if (!messages) return;
  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 10;
  isScrollLocked = !atBottom;
});

// ---------------- Dark Theme Toggle ----------------
toggleThemeBtn?.addEventListener('click', () => {
  darkMode = !darkMode;
  document.body.classList.toggle('dark', darkMode);
  localStorage.setItem('darkMode', darkMode);
});

// ---------------- Leave Button ----------------
leaveBtn?.addEventListener('click', () => {
  if (socket) socket.disconnect();
  location.reload();
});


// Admin / commands via Enter key (non-invasive)
if (typeof input !== 'undefined' && input) {
  input.addEventListener('keydown', (e) => {
    try {
      if (e.key === 'Enter' && !e.shiftKey) {
        const raw = (input.value || '').trim();
        if (raw.startsWith('/')) {
          e.preventDefault();
          const parts = raw.slice(1).split(/\s+/);
          const cmd = parts[0]; const rest = parts.slice(1).join(' ');
          if (['ban','kick'].includes(cmd) && rest) {
            socket.emit('moderate', { room: currentRoom, cmd, target: rest });
            input.value='';
            return;
          }
          if (cmd === 'announce' && rest) {
            socket.emit('announce', { room: currentRoom, text: rest });
            input.value='';
            return;
          }
        }
      }
    } catch(_) {}
  });
}

// Announcement render
socket.on('announcement', ({ text, at, by }) => {
  const messages = document.getElementById('messages');
  if (!messages) return;
  const wrap = document.createElement('div');
  wrap.className = 'announcement';
  wrap.innerHTML = `<strong>📢 Announcement</strong> from <span class="admin-name">${by}</span><br>${text}`;
  messages.appendChild(wrap);
  wrap.scrollIntoView({ behavior: 'smooth', block: 'end' });
});
