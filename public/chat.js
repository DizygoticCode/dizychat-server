// DOM elements
const usernamePrompt=document.getElementById('username-prompt');
const joinBtn=document.getElementById('join-btn');
const usernameInput=document.getElementById('username-input');
const roomInput=document.getElementById('room-input');
const roomPasswordInput=document.getElementById('room-password');
const chatContainer=document.getElementById('chat-container');
const roomNameSpan=document.getElementById('room-name');
const messages=document.getElementById('messages');
const form=document.getElementById('form');
const input=document.getElementById('input');
const emojiBtn=document.getElementById('emoji-btn');
const emojiPicker=document.getElementById('emoji-picker');
const quickEmojis=document.querySelectorAll('#quick-emojis button');
const typingBubble=document.getElementById('typing-bubble');
const pinnedList=document.getElementById('pinned-list');
const searchInput=document.getElementById('searchInput');

let socket=null,currentUser='',currentRoom='',roomPassword='',typingTimeout=null,autoScrollEnabled=true;

// ---------------- Join Landing Page ----------------
joinBtn.addEventListener('click',()=>{
  const username=usernameInput.value.trim();
  const room=roomInput.value.trim();
  if(!username||!room)return alert('Enter username and room');
  currentUser=username; currentRoom=room;
  roomPassword=roomPasswordInput.value.trim();
  usernamePrompt.style.display='none';
  chatContainer.style.display='flex';
  roomNameSpan.textContent=currentRoom;
  initChat();
  saveRecentRoom(room); loadRecentRooms();
});

// ---------------- Recent Rooms ----------------
function saveRecentRoom(room){
  let recent=JSON.parse(localStorage.getItem('recentRooms')||'[]');
  if(!recent.includes(room)){ recent.push(room); if(recent.length>5) recent.shift(); localStorage.setItem('recentRooms',JSON.stringify(recent)); }
}
function loadRecentRooms(){
  const list=document.getElementById('public-room-list'); if(!list)return;
  list.innerHTML=''; let recent=JSON.parse(localStorage.getItem('recentRooms')||'[]');
  recent.forEach(r=>{ const li=document.createElement('li'); li.textContent=r; li.addEventListener('click',()=>{ roomInput.value=r; joinBtn.click(); }); list.appendChild(li); });
}

// ---------------- Init Chat ----------------
function initChat(){
  socket=io();
  socket.on('connect',()=>{ socket.emit('join room',{room:currentRoom,password:roomPassword}); socket.emit('get pinned',{room:currentRoom}); });
  socket.on('chat message',displayMessage);
  socket.on('pinned messages',renderPinned);
  socket.on('update reactions',updateReactions);
  socket.on('typing',showTyping);
}

// ---------------- Display Messages ----------------
function displayMessage(msg,prepend=false){
  if(!msg)return;
  const id=msg._id||msg.id||msg.tempId;
  if(id && document.querySelector(`.message[data-id='${id}']`)) return;

  const div=document.createElement('div'); div.className=`message ${msg.user===currentUser?'self':'other'}`; if(id) div.dataset.id=id;

  const meta=document.createElement('div'); meta.className='meta'; meta.textContent=`${msg.user} • ${new Date(msg.time||Date.now()).toLocaleTimeString()}`; div.appendChild(meta);
  const text=document.createElement('div'); text.className='text'; text.textContent=msg.text||''; div.appendChild(text);

  const reactionsDiv=document.createElement('div'); reactionsDiv.className='reactions';
  if(msg.reactions) msg.reactions.forEach(r=>{ const s=document.createElement('span'); s.textContent=r.emoji; reactionsDiv.appendChild(s); });
  div.appendChild(reactionsDiv);

  // Star & Pin Buttons
  if(msg.user!==currentUser){
    const starBtn=document.createElement('button'); starBtn.className='star-btn';
    starBtn.textContent=(msg.starredBy||[]).includes(currentUser)?'⭐':'☆';
    starBtn.dataset.tooltip='Star this message';
    starBtn.addEventListener('click',()=>{ if(starBtn.textContent==='⭐') socket.emit('unstar message',{room:currentRoom,id}); else socket.emit('star message',{room:currentRoom,id}); });
    div.appendChild(starBtn);
  }
  const pinBtn=document.createElement('button'); pinBtn.className='pin-btn';
  pinBtn.textContent=msg.pinned?'📌':'📍';
  pinBtn.dataset.tooltip=msg.pinned?'Unpin message':'Pin message';
  pinBtn.addEventListener('click',()=>{ if(msg.pinned) socket.emit('unpin message',{room:currentRoom,id}); else socket.emit('pin message',{room:currentRoom,id}); });
  div.appendChild(pinBtn);

  prepend?messages.prepend(div):messages.appendChild(div);
  if(autoScrollEnabled) div.scrollIntoView({behavior:'smooth',block:'end'});
}

// ---------------- Typing ----------------
input.addEventListener('input',()=>{
  if(!socket)return;
  if(input.value.trim()){ socket.emit('typing',{user:currentUser,room:currentRoom}); clearTimeout(typingTimeout); typingTimeout=setTimeout(stopTyping,1500); } else stopTyping();
});
function stopTyping(){ socket?.emit('stop typing',{user:currentUser,room:currentRoom}); }
function showTyping(users){ if(!Array.isArray(users)) return; const others=users.filter(u=>u!==currentUser); typingBubble.style.display=others.length?'block':'none'; typingBubble.textContent=others.length?`${others.join(', ')} typing...`:''; }

// ---------------- Emoji Picker ----------------
emojiBtn.addEventListener('click',()=>emojiPicker.classList.toggle('show'));
quickEmojis.forEach(btn=>{ btn.addEventListener('click',()=>{ input.value+=btn.textContent; input.focus(); }); });

// ---------------- Form Submit ----------------
form.addEventListener('submit',e=>{ e.preventDefault(); if(!input.value.trim()) return;
  const msg={user:currentUser,room:currentRoom,text:input.value.trim(),time:Date.now()};
  socket.emit('chat message',msg); displayMessage(msg); input.value='';
});

// ---------------- Pinned ----------------
function renderPinned(msgs){ if(!msgs||!msgs.length) return; pinnedList.innerHTML=''; msgs.forEach(m=>{ const li=document.createElement('li'); li.textContent=`${m.user}: ${m.text}`; pinnedList.appendChild(li); }); }

// ---------------- Reactions ----------------
function updateReactions({id,reactions}){ const msgEl=document.querySelector(`.message[data-id='${id}']`); if(!msgEl) return; const reactionsDiv=msgEl.querySelector('.reactions'); reactionsDiv.innerHTML=''; reactions.forEach(r=>{ const span=document.createElement('span'); span.textContent=r.emoji; reactionsDiv.appendChild(span); }); }
