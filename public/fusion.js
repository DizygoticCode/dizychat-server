// ===== DIZYCHAT FUSION CLIENT (non-invasive) =====
const adminPasswordInput = document.getElementById('admin-password');
let isAdmin = false;

// Post-join admin auth
(function authAfterJoin(){
  const joinBtn = document.getElementById('join-btn');
  if (!joinBtn || !window.io) return;
  joinBtn.addEventListener('click', () => {
    setTimeout(() => {
      const room = document.getElementById('room-input')?.value.trim();
      const user = document.getElementById('username-input')?.value.trim();
      const pass = adminPasswordInput?.value.trim();
      if (window.socket) window.socket.emit('admin auth', { room, username: user, adminPassword: pass });
    }, 600);
  });
})();

// Admin status + announcement bubble
if (window.socket) {
  socket.on('admin status', ({ isAdmin: flag }) => {
    isAdmin = !!flag;
    if (isAdmin) {
      const badge = document.createElement('span');
      badge.className = 'admin-badge';
      badge.textContent = '👑 Admin Mode';
      document.getElementById('room-name')?.appendChild(badge);
      console.log('[admin] entered admin mode');
    } else {
      console.log('[admin] standard user mode');
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

// Slash commands: /ban, /kick, /announce
(function hookFormSubmit(){
  const form = document.getElementById('form');
  const input = document.getElementById('input');
  if (!form || !input) return;
  form.addEventListener('submit', function(e){
    const raw = (input.value || '').trim();
    if (!raw.startsWith('/')) return;
    const parts = raw.slice(1).split(/\s+/);
    const cmd = parts[0]; const rest = parts.slice(1).join(' ');
    if (['ban','kick'].includes(cmd) && rest) {
      e.preventDefault(); socket.emit('moderate', { room: window.currentRoom, cmd, target: rest }); input.value=''; return;
    }
    if (cmd === 'announce' && rest) {
      e.preventDefault(); socket.emit('announce', { room: window.currentRoom, text: rest }); input.value=''; return;
    }
  }, true);
})();

// Tenor GIF picker beside emoji (keeps Psybin UI intact)
(function tenorPicker(){
  const form = document.getElementById('form');
  const emojiBtn = document.getElementById('emoji-btn');
  if (!form || !emojiBtn) return;

  const gifBtn = document.createElement('button');
  gifBtn.id = 'gif-btn'; gifBtn.textContent = 'GIF'; gifBtn.type = 'button'; gifBtn.style.marginLeft = '6px';
  emojiBtn.insertAdjacentElement('afterend', gifBtn);

  const panel = document.createElement('div');
  panel.id = 'gif-picker';
  panel.innerHTML = '<div class="gif-search"><input id="gif-search-input" placeholder="Search GIFs…"></div><div id="gif-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;"></div>';
  document.body.appendChild(panel);

  function positionPanel(){
    const rect = form.getBoundingClientRect();
    panel.style.position='fixed';
    panel.style.left = (rect.left + 8) + 'px';
    panel.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
  }

  gifBtn.onclick = async () => {
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    positionPanel();
    if (!panel.dataset.loaded) {
      try {
        const res = await fetch('https://g.tenor.com/v1/trending?key=LIVDSRZULELA&limit=24');
        const data = await res.json();
        const grid = document.getElementById('gif-grid');
        grid.innerHTML = '';
        (data.results || []).forEach(g => {
          const url = g.media?.[0]?.tinygif?.url || g.media?.[0]?.gif?.url;
          if (!url) return;
          const img = document.createElement('img');
          img.src = url; img.alt = 'gif';
          img.style.borderRadius='8px'; img.style.cursor='pointer'; img.style.width='100%'; img.style.height='100%'; img.style.objectFit='cover';
          img.onclick = () => {
            socket.emit('chat message', { room: window.currentRoom, user: window.currentUser, text: (g.media?.[0]?.gif?.url || url) });
            panel.style.display='none';
          };
          const cell = document.createElement('div'); cell.className='gif-item'; cell.appendChild(img);
          grid.appendChild(cell);
        });
        panel.dataset.loaded = '1';
      } catch {
        const grid = document.getElementById('gif-grid');
        grid.innerHTML = '<div class="gif-error">GIFs failed to load.</div>';
      }
    }
  };
  window.addEventListener('resize', () => { if (panel.style.display==='block') positionPanel(); });
})();

// Media & light OG previews without touching Psybin renderer
function enhanceNode(node){
  const textEl = node.querySelector?.('.text') || node;
  const txt = textEl ? (textEl.textContent || '') : (node.textContent || '');
  if (!txt) return;

  const links = (txt.match(/https?:\/\/\S+/g) || []).slice(0,3);
  if (!links.length) return;

  const wrap = document.createElement('div'); wrap.className = 'embed-wrap';

  for (const link of links) {
    let em = null, m;
    // YouTube
    m = link.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/i);
    if (m) { const ifr = document.createElement('iframe'); ifr.src = 'https://www.youtube.com/embed/' + m[1]; ifr.className = 'embed-iframe'; ifr.setAttribute('allowfullscreen','true'); em = ifr; }
    // Spotify
    if (!em) {
      m = link.match(/https?:\/\/open\.spotify\.com\/(track|album|playlist)\/([\w]+)/i);
      if (m) { const ifr = document.createElement('iframe'); ifr.src = 'https://open.spotify.com/embed/' + m[1] + '/' + m[2]; ifr.className = 'embed-iframe'; em = ifr; }
    }
    // SoundCloud
    if (!em && /https?:\/\/(?:soundcloud\.com|snd\.sc)\//i.test(link)) {
      const ifr = document.createElement('iframe'); ifr.src = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(link); ifr.className='embed-iframe'; em = ifr;
    }
    // Images
    if (!em && /\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(link)) {
      const img = document.createElement('img'); img.src = link; img.className = 'embed-image'; em = img;
    }
    // Video
    if (!em && /\.(mp4|webm|mov)(\?.*)?$/i.test(link)) {
      const v = document.createElement('video'); v.src = link; v.controls = true; v.className = 'embed-media'; em = v;
    }
    // Audio
    if (!em && /\.(mp3|wav|ogg)(\?.*)?$/i.test(link)) {
      const a = document.createElement('audio'); a.src = link; a.controls = true; a.className = 'embed-audio'; em = a;
    }

    if (em) wrap.appendChild(em);
  }

  if (wrap.childNodes.length) node.appendChild(wrap);

  // Collapsible OG for non-media links
  (async () => {
    const normals = links.filter(u => !/(youtube|youtu\.be|open\.spotify|soundcloud|\.mp4|\.webm|\.mov|\.mp3|\.wav|\.ogg|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.pdf)/i.test(u));
    for (const u of normals) {
      try {
        const res = await fetch('/link-preview?url=' + encodeURIComponent(u));
        const data = await res.json();
        if (!data || (!data.title && !data.image)) continue;
        const card = document.createElement('div'); card.className='link-card';
        const header = document.createElement('div'); header.className='link-header';
        header.innerHTML = '<span class="toggle">▶️</span><span class="domain">'+ new URL(u).hostname +'</span>';
        const body = document.createElement('div'); body.className='link-body';
        body.innerHTML = (data.image ? '<img src="'+data.image+'" alt="">' : '') + '<div class="title">'+ (data.title || u) +'</div>';
        const toggle = header.querySelector('.toggle');
        card.appendChild(header); card.appendChild(body);
        header.onclick = () => { card.classList.toggle('open'); toggle.textContent = card.classList.contains('open') ? '🔽' : '▶️'; };
        body.onclick = () => window.open(u, '_blank');
        node.appendChild(card);
      } catch {}
    }
  })();
}

(function observeMessages(){
  const msg = document.getElementById('messages');
  if (!msg) return;
  Array.from(msg.children).forEach(enhanceNode);
  const mo = new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType===1) enhanceNode(n); })));
  mo.observe(msg, { childList:true });
})();
