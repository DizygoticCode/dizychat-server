// ===== DIZYCHAT FUSION CLIENT =====
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

// Admin feedback
if (window.socket) {
  socket.on('admin status', ({ isAdmin: flag }) => {
    isAdmin = !!flag;
    if (isAdmin) {
      const badge = document.createElement('span');
      badge.className = 'admin-badge';
      badge.textContent = '👑 Admin Mode';
      document.getElementById('room-name')?.appendChild(badge);
      console.log('[admin] entered admin mode');
    }
  });

  socket.on('announcement', ({ text, by }) => {
    const messages = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'system-bubble';
    div.innerHTML = `📢 Announcement from <span class="admin-name">${by}</span><br>${text}`;
    messages.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
  });
}

// Slash commands
document.getElementById('form').addEventListener('submit', e => {
  const input = document.getElementById('input');
  const raw = (input.value || '').trim();
  if (raw.startsWith('/')) {
    const [cmd, ...rest] = raw.slice(1).split(/\s+/);
    const txt = rest.join(' ');
    if (['ban','kick'].includes(cmd) && txt) {
      e.preventDefault();
      socket.emit('moderate', { room: window.currentRoom, cmd, target: txt });
      input.value='';
    }
    if (cmd === 'announce' && txt) {
      e.preventDefault();
      socket.emit('announce', { room: window.currentRoom, text: txt });
      input.value='';
    }
  }
});

// Tenor GIF picker (beside emoji)
(function tenorPicker(){
  const form = document.getElementById('form');
  const emojiBtn = document.getElementById('emoji-btn');
  const gifBtn = document.createElement('button');
  gifBtn.id = 'gif-btn'; gifBtn.textContent = 'GIF'; gifBtn.type = 'button';
  emojiBtn.insertAdjacentElement('afterend', gifBtn);
  const panel = document.createElement('div');
  panel.id = 'gif-picker';
  panel.innerHTML = '<div class="gif-search"><input id="gif-search-input" placeholder="Search GIFs…"></div><div id="gif-grid"></div>';
  document.body.appendChild(panel);

  gifBtn.onclick = async () => {
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    if (!panel.dataset.loaded) {
      const res = await fetch('https://g.tenor.com/v1/trending?key=LIVDSRZULELA&limit=24');
      const data = await res.json();
      const grid = document.getElementById('gif-grid');
      grid.innerHTML = '';
      data.results.forEach(g => {
        const img = document.createElement('img');
        img.src = g.media[0].tinygif.url;
        img.onclick = () => {
          socket.emit('chat message', { room: window.currentRoom, user: window.currentUser, text: g.media[0].gif.url });
          panel.style.display='none';
        };
        grid.appendChild(img);
      });
      panel.dataset.loaded = '1';
    }
  };
})();

// Media & link previews
function enhanceLinks(node){
  const text = node.textContent;
  const yt = text.match(/https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/\S+/);
  if (yt) {
    const iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube.com/embed/' + yt[0].split('v=')[1];
    iframe.className = 'embed-iframe';
    node.appendChild(iframe);
  }
}
const obs = new MutationObserver(m=>m.forEach(x=>x.addedNodes.forEach(n=>n.nodeType===1&&enhanceLinks(n))));
obs.observe(document.getElementById('messages'), { childList:true });
