// ===== DIZY FUSION CLIENT (non-invasive) =====

// 0) Reuse your existing paperclip + hidden input (no duplicates!)
(() => {
  const attachBtn = document.getElementById('file-attach');
  const fileInput = document.getElementById('file-input');
  if (attachBtn && fileInput) {
    fileInput.setAttribute('accept', '*/*'); // all types
    attachBtn.addEventListener('click', () => fileInput.click());
  }
})();

// 1) Admin status + announcement bubble (kept light)
if (window.socket) {
  socket.on('admin status', ({ isAdmin }) => {
    console.log('[admin] mode:', isAdmin ? 'ON' : 'OFF');
    if (!isAdmin) return;
    const badge = document.querySelector('#room-name .admin-badge');
    if (!badge) {
      const span = document.createElement('span');
      span.className = 'admin-badge';
      span.textContent = '👑 Admin Mode';
      document.getElementById('room-name')?.appendChild(span);
    }
  });

  socket.on('announcement', ({ text, by }) => {
    const messages = document.getElementById('messages');
    if (!messages) return;
    const div = document.createElement('div');
    div.className = 'system-bubble';
    div.innerHTML = `📢 Announcement from <span class="admin-name">${by}</span><br>${text}`;
    messages.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
  });
}

// 2) Slash commands: /ban, /kick, /announce
(() => {
  const form = document.getElementById('form');
  const input = document.getElementById('input');
  if (!form || !input) return;
  form.addEventListener('submit', (e) => {
    const raw = (input.value || '').trim();
    if (!raw.startsWith('/')) return;
    const [cmd, ...rest] = raw.slice(1).split(/\s+/);
    const payload = rest.join(' ');
    if (['ban','kick'].includes(cmd) && payload) {
      e.preventDefault(); socket.emit('moderate', { room: window.currentRoom, cmd, target: payload }); input.value=''; return;
    }
    if (cmd === 'announce' && payload) {
      e.preventDefault(); socket.emit('announce', { room: window.currentRoom, text: payload }); input.value=''; return;
    }
  }, true);
})();

// 3) Tenor GIF picker beside emoji (hardcoded key, plays on click)
(() => {
  const TENOR_API_KEY = 'LIVDSRZULELA'; // hardcoded for testing (as requested)
  const form = document.getElementById('form');
  const emojiBtn = document.getElementById('emoji-btn');
  if (!form || !emojiBtn) return;

  const gifBtn = document.createElement('button');
  gifBtn.id = 'gif-btn'; gifBtn.type = 'button'; gifBtn.textContent = 'GIF';
  gifBtn.style.marginLeft = '6px';
  emojiBtn.insertAdjacentElement('afterend', gifBtn);

  const panel = document.createElement('div');
  panel.id = 'gif-picker';
  panel.innerHTML = `
    <div class="gif-search">
      <input id="gif-search-input" placeholder="Search GIFs…">
    </div>
    <div id="gif-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;"></div>`;
  document.body.appendChild(panel);

  function positionPanel(){
    const rect = form.getBoundingClientRect();
    panel.style.position='fixed';
    panel.style.left = (rect.left + 8) + 'px';
    panel.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
  }

  function pickTenorGifUrl(g) {
    return (
      g?.media_formats?.gif?.url ||
      g?.media_formats?.mediumgif?.url ||
      g?.media_formats?.tinygif?.url ||
      g?.media_formats?.mp4?.url ||          // fallback (mp4 ok in <video>)
      g?.media?.[0]?.gif?.url ||
      g?.media?.[0]?.mediumgif?.url ||
      g?.media?.[0]?.tinygif?.url ||
      null
    );
  }

  async function loadTenor(endpoint){
    try {
      const res = await fetch(endpoint);
      const data = await res.json();
      const grid = document.getElementById('gif-grid');
      grid.innerHTML = '';
      (data.results || []).forEach(g => {
        const thumb = g?.media_formats?.tinygif?.url ||
                      g?.media_formats?.gif?.url ||
                      g?.media?.[0]?.tinygif?.url ||
                      g?.media?.[0]?.gif?.url;
        if (!thumb) return;
        const img = document.createElement('img');
        img.src = thumb;
        img.alt = 'gif';
        img.style.width='100%'; img.style.height='100%'; img.style.objectFit='cover';
        img.style.borderRadius = '8px'; img.style.cursor='pointer';
        img.onclick = () => {
          const url = pickTenorGifUrl(g);
          if (!url) return;
          socket.emit('chat message', {
            room: window.currentRoom,
            user: window.currentUser,
            text: url,
            timestamp: Date.now()
          });
          panel.style.display = 'none';
          document.getElementById('input')?.focus();
        };
        const cell = document.createElement('div');
        cell.className = 'gif-item';
        cell.appendChild(img);
        grid.appendChild(cell);
      });
    } catch(e) {
      const grid = document.getElementById('gif-grid');
      grid.innerHTML = '<div class="gif-error">GIFs failed to load.</div>';
      console.log('[GIF] Tenor error:', e);
    }
  }

  gifBtn.onclick = () => {
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    positionPanel();
    if (!panel.dataset.loaded) {
      loadTenor(`https://g.tenor.com/v1/trending?key=${TENOR_API_KEY}&limit=24`);
      panel.dataset.loaded = '1';
    }
  };

  const searchInput = panel.querySelector('#gif-search-input');
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = searchInput.value.trim();
      if (!q) return;
      loadTenor(`https://g.tenor.com/v1/search?q=${encodeURIComponent(q)}&key=${TENOR_API_KEY}&limit=24`);
    }
  });

  window.addEventListener('resize', () => { if (panel.style.display==='block') positionPanel(); });
})();

// 4) Optional: OG preview cards enhancer (safe + compact)
(async () => {
  const messages = document.getElementById('messages');
  if (!messages) return;

  async function fetchPreview(url){
    try { const r = await fetch('/link-preview?url=' + encodeURIComponent(url)); return await r.json(); }
    catch { return null; }
  }

  function embedMedia(node) {
    const textEl = node.querySelector?.('.text') || node;
    const txt = textEl ? (textEl.textContent || '') : (node.textContent || '');
    if (!txt) return;
    const links = (txt.match(/https?:\/\/\S+/g) || []).slice(0,3);
    if (!links.length) return;

    const wrap = document.createElement('div'); wrap.className = 'embed-wrap';

    links.forEach(link => {
      let el = null;
      // YouTube
      let m = link.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/i);
      if (m) {
        const ifr = document.createElement('iframe');
        ifr.src = 'https://www.youtube.com/embed/' + m[1];
        ifr.className = 'embed-iframe'; ifr.setAttribute('allowfullscreen','true');
        el = ifr;
      }
      // Spotify
      if (!el) {
        m = link.match(/https?:\/\/open\.spotify\.com\/(track|album|playlist)\/([\w]+)/i);
        if (m) {
          const ifr = document.createElement('iframe');
          ifr.src = `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
          ifr.className = 'embed-iframe';
          el = ifr;
        }
      }
      // SoundCloud
      if (!el && /https?:\/\/(?:soundcloud\.com|snd\.sc)\//i.test(link)) {
        const ifr = document.createElement('iframe');
        ifr.src = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(link);
        ifr.className = 'embed-iframe';
        el = ifr;
      }
      // Direct media
      if (!el && /\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(link)) {
        const img = document.createElement('img'); img.src = link; img.className = 'embed-image'; el = img;
      }
      if (!el && /\.(mp4|webm|mov)(\?.*)?$/i.test(link)) {
        const v = document.createElement('video'); v.src = link; v.controls = true; v.className = 'embed-media'; el = v;
      }
      if (!el && /\.(mp3|wav|ogg)(\?.*)?$/i.test(link)) {
        const a = document.createElement('audio'); a.src = link; a.controls = true; a.className = 'embed-audio'; el = a;
      }
      if (el) wrap.appendChild(el);
    });

    if (wrap.childNodes.length) node.appendChild(wrap);

    // Collapsible OG cards for non-media links
    (async () => {
      const normal = links.filter(u => !/(youtube|youtu\.be|open\.spotify|soundcloud|\.mp4|\.webm|\.mov|\.mp3|\.wav|\.ogg|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.pdf)/i.test(u));
      for (const u of normal) {
        const d = await fetchPreview(u);
        if (!d || (!d.title && !d.image)) continue;
        const card = document.createElement('div'); card.className='link-card';
        const header = document.createElement('div'); header.className='link-header';
        header.innerHTML = `<span class="toggle">▶️</span><span class="domain">${new URL(u).hostname}</span>`;
        const body = document.createElement('div'); body.className='link-body';
        body.innerHTML = (d.image ? `<img src="${d.image}" alt="">` : '') + `<div class="title">${d.title || u}</div>`;
        const toggle = header.querySelector('.toggle');
        card.appendChild(header); card.appendChild(body);
        header.onclick = () => { card.classList.toggle('open'); toggle.textContent = card.classList.contains('open') ? '🔽' : '▶️'; };
        body.onclick = () => window.open(u, '_blank');
        node.appendChild(card);
      }
    })();
  }

  // existing + future messages
  Array.from(messages.children).forEach(embedMedia);
  new MutationObserver(m => m.forEach(r => r.addedNodes.forEach(n => { if (n.nodeType===1) embedMedia(n); })))
    .observe(messages, { childList: true });
})();
