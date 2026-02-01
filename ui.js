// ui.js - Modernized UI logic
import {
  handleLogin as apiLogin,
  handleSignup as apiSignup,
  logout as apiLogout,
  getSession,
  onAuthStateChange,
  getCurrentUser,
  checkNicknameAvailability,
  searchUsers,
  loadFriends as apiLoadFriends,
  loadFriendRequests as apiLoadFriendRequests,
  sendFriendRequest as apiSendFriendRequest,
  acceptFriendRequest as apiAcceptFriendRequest,
  declineFriendRequest as apiDeclineFriendRequest,
  removeFriend as apiRemoveFriend,
  blockUser as apiBlockUser,
  loadMessages as apiLoadMessages,
  sendMessage as apiSendMessage,
  subscribeToMessages,
  subscribeToFriendRequests,
  removeSubscription
} from './supabase.js';

// --- Helpers ---
const qs = (id) => document.getElementById(id);
const el = (tag, cls = '') => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  return d;
};
const sanitizeHTML = (str) => {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
};

// --- State ---
let currentUser = null;
let currentChat = null;
let friends = [];
let friendRequests = [];
let messageSubscription = null;
let friendRequestSubscription = null;
let searchTimeout = null;
let nicknameCheckTimeout = null;
let lastRenderedMessageId = null;

// --- DOM Refs ---
const dom = {
  authContainer: qs('auth-container'),
  chatContainer: qs('chat-container'),
  landingPage: qs('landing-page'),
  loginPage: qs('login-page'),
  signupPage: qs('signup-page'),
  
  // Chat Refs
  friendsPanel: qs('friends-panel'),
  chatMainArea: document.querySelector('.chat-main-area'),
  chatWindow: qs('chat-window'),
  welcomeState: qs('welcome-state'),
  messagesArea: qs('messages-area'),
  messageForm: qs('message-form'),
  messageInput: qs('message-input'),
  friendSearch: qs('friend-search'),
  
  // Buttons
  openFriendsBtn: qs('open-friends-btn'),
  mobileBackBtn: qs('mobile-back-btn'),
  logoutBtn: qs('logout-btn'),
  
  // Dynamic Text
  userName: qs('current-user-name'),
  friendsCount: qs('friends-count'),
  requestsCount: qs('requests-count')
};

// --- Init ---
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupEventListeners();
  setupNetworkMonitoring();
  
  try {
    const { data: { session } } = await getSession();
    if (session) {
      await loadUserData();
      showChatInterface();
    } else {
      showLanding();
    }

    onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        await loadUserData();
        showChatInterface();
      } else if (event === 'SIGNED_OUT') {
        cleanupAfterLogout();
      }
    });
  } catch (err) {
    console.error('Init error', err);
    showToast('Failed to initialize app', 'error');
  }
}

// --- Event Listeners ---
function setupEventListeners() {
  // Auth Navigation
  qs('landing-login-btn').onclick = () => showPage('login');
  qs('landing-signup-btn').onclick = () => showPage('signup');
  qs('signup-link').onclick = (e) => { e.preventDefault(); showPage('signup'); };
  qs('login-link').onclick = (e) => { e.preventDefault(); showPage('login'); };

  // Forms
  qs('login-form').onsubmit = handleLogin;
  qs('signup-form').onsubmit = handleSignup;
  dom.messageForm.onsubmit = handleSendMessage;

  // Validation
  qs('signup-nickname').oninput = handleNicknameInput;

  // Global Actions
  dom.logoutBtn.onclick = handleLogout;

  // Mobile Nav
  dom.openFriendsBtn.onclick = () => {
    // On mobile, this usually means "Show sidebar" if hidden, but our CSS handles overlap.
    // However, our new CSS assumes chat-main-area slides in.
    // If we want to strictly go "back" to friends list from chat:
    toggleMobileChat(false); 
  };
  
  dom.mobileBackBtn.onclick = () => {
    toggleMobileChat(false);
  };

  // Friend Search
  dom.friendSearch.oninput = (e) => {
    const q = e.target.value.trim();
    if (searchTimeout) clearTimeout(searchTimeout);
    if (q.length < 2) {
      removeSearchResults(); // Custom helper
      return;
    }
    searchTimeout = setTimeout(() => doSearch(q), 300);
  };

  // Friend Requests Delegation
  qs('friend-requests').onclick = (e) => {
    const accept = e.target.closest('.accept-btn');
    const decline = e.target.closest('.decline-btn');
    const item = e.target.closest('.friend-request-item');
    if (!item) return;
    const reqId = item.dataset.reqId;
    
    // Prevent bubbling if we clicked a button
    if (accept) handleAcceptFriendRequest(reqId, item);
    else if (decline) handleDeclineFriendRequest(reqId, item);
  };

  // Refresh Buttons
  qs('refresh-friends-btn').onclick = fetchFriendsAndRequests;
  qs('refresh-messages-btn').onclick = fetchMessages;

  // Dropdown
  const menuBtn = qs('friend-options-btn');
  const menu = qs('friend-options-menu');
  menuBtn.onclick = (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  };
  document.onclick = () => menu.classList.add('hidden');
  
  qs('remove-friend-btn').onclick = () => { if(currentChat) handleRemoveFriend(currentChat.id); };
  qs('block-friend-btn').onclick = () => { if(currentChat) handleBlockUser(currentChat.id); };

  // Enter Key for Message
  dom.messageInput.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      dom.messageForm.requestSubmit();
    }
  };
  
  // Resize handler for mobile keyboard
  window.onresize = () => {
    if (currentChat && !dom.chatWindow.classList.contains('hidden')) {
      scrollToBottom();
    }
  };
}


// --- Auth Logic ---
async function handleLogin(e) {
  e.preventDefault();
  setLoading('login-btn', true);
  
  const email = qs('login-email').value.trim();
  const password = qs('login-password').value;
  
  try {
    const { error } = await apiLogin(email, password);
    if (error) throw error;
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setLoading('login-btn', false);
  }
}

async function handleSignup(e) {
  e.preventDefault();
  setLoading('signup-btn', true);

  const nickname = qs('signup-nickname').value.trim().replace('@', '');
  const email = qs('signup-email').value.trim();
  const password = qs('signup-password').value;

  try {
    const { data, error } = await apiSignup(email, password, nickname);
    if (error) throw error;
    showToast('Account created! Please verify your email.', 'success');
    showPage('login');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setLoading('signup-btn', false);
  }
}

async function handleLogout() {
  await apiLogout();
}

async function loadUserData() {
  try {
    currentUser = await getCurrentUser();
    dom.userName.textContent = '@' + currentUser.nickname;
  } catch (err) {
    console.error(err);
    showToast('Failed to load profile', 'error');
  }
}


// --- Navigation / UI State ---
function showPage(pageName) {
  dom.landingPage.classList.add('hidden');
  dom.loginPage.classList.add('hidden');
  dom.signupPage.classList.add('hidden');
  
  if (pageName === 'login') dom.loginPage.classList.remove('hidden');
  else if (pageName === 'signup') dom.signupPage.classList.remove('hidden');
  else dom.landingPage.classList.remove('hidden');
}

function showChatInterface() {
  dom.authContainer.classList.add('hidden');
  dom.chatContainer.classList.remove('hidden');
  fetchFriendsAndRequests();
  setupGlobSubscriptions();
}

function showLanding() {
  dom.chatContainer.classList.add('hidden');
  dom.authContainer.classList.remove('hidden');
  showPage('landing');
}

function toggleMobileChat(isActive) {
  // Mobile CSS uses .mobile-chat-active on chat-main to slide it in
  const main = document.querySelector('.chat-layout'); 
  // Wait, looking at style.css:
  // .mobile-chat-active .chat-main-area { transform: translateX(0); }
  // default is translateX(100%)
  
  if (isActive) {
    dom.chatMainArea.parentNode.classList.add('mobile-chat-active');
  } else {
    dom.chatMainArea.parentNode.classList.remove('mobile-chat-active');
    // Also clear selection visually
    document.querySelectorAll('.friend-item').forEach(i => i.classList.remove('active'));
    currentChat = null;
  }
}


// --- Friends Logic ---
async function fetchFriendsAndRequests() {
  await Promise.all([fetchFriends(), fetchRequests()]);
}

async function fetchFriends() {
  if (!currentUser) return;
  const { data, error } = await apiLoadFriends(currentUser.id);
  
  const container = qs('friends-list');
  if (error) {
    container.innerHTML = `<div class="p-4 text-center text-muted">Error loading friends</div>`;
    return;
  }
  
  friends = data.map(f => f.user_id === currentUser.id ? f.friend_profile : f.user_profile);
  dom.friendsCount.textContent = friends.length;
  
  if (friends.length === 0) {
    container.innerHTML = `<div class="p-4 text-center text-muted" style="opacity:0.7">No friends yet. Search to add someone!</div>`;
    return;
  }
  
  renderFriendsList();
}

async function fetchRequests() {
  if (!currentUser) return;
  const { data, error } = await apiLoadFriendRequests(currentUser.id);
  if (error) return;
  
  friendRequests = data || [];
  dom.requestsCount.textContent = friendRequests.length;
  renderRequestsList();
}

function renderFriendsList() {
  const container = qs('friends-list');
  // Preserve Search Results if they exist
  const searchRes = container.querySelector('.search-results-section');
  
  container.innerHTML = '';
  if (searchRes) container.appendChild(searchRes);
  
  friends.forEach(friend => {
    const el = document.createElement('div');
    el.className = 'friend-item';
    el.dataset.id = friend.id;
    el.innerHTML = `
      <div class="friend-avatar">${friend.nickname.charAt(0).toUpperCase()}</div>
      <div class="peer-info">
        <h4>${sanitizeHTML(friend.nickname)}</h4>
        <div class="friend-nickname">@${sanitizeHTML(friend.nickname)}</div>
      </div>
    `;
    el.onclick = () => selectFriend(friend);
    container.appendChild(el);
  });
}

function renderRequestsList() {
  const container = qs('friend-requests');
  container.innerHTML = '';
  
  if (friendRequests.length === 0) {
    container.innerHTML = '<div class="text-muted p-2" style="font-size:0.9rem">No pending requests</div>';
    return;
  }

  friendRequests.forEach(req => {
    const el = document.createElement('div');
    el.className = 'friend-request-item';
    el.dataset.reqId = req.id;
    el.innerHTML = `
      <div class="request-avatar">${req.user_profile.nickname.charAt(0).toUpperCase()}</div>
      <div class="peer-info" style="flex:1">
        <h4>${sanitizeHTML(req.user_profile.nickname)}</h4>
      </div>
      <div class="request-actions">
        <button class="btn btn--sm btn--primary accept-btn">Accept</button>
        <button class="btn btn--sm btn--outline decline-btn">✕</button>
      </div>
    `;
    container.appendChild(el);
  });
}


// --- Search ---
async function doSearch(query) {
  if (!currentUser) return;
  
  try {
    const queryClean = query.replace(/^@/, '');
    const { data } = await searchUsers(queryClean, currentUser.id);
    renderSearchResults(data || []);
  } catch (err) {
    console.error(err);
  }
}

function renderSearchResults(users) {
  const container = qs('friends-list');
  removeSearchResults(); // clear old
  
  const section = document.createElement('div');
  section.className = 'search-results-section';
  section.style.marginBottom = '16px';
  section.innerHTML = `<div class="section-label">Search Results</div>`;
  
  if (users.length === 0) {
    section.innerHTML += `<div class="p-2 text-muted">No users found</div>`;
  } else {
    users.forEach(u => {
      const isFriend = friends.some(f => f.id === u.id);
      if (isFriend) return; // skip friends
      
      const item = document.createElement('div');
      item.className = 'friend-item';
      item.innerHTML = `
        <div class="friend-avatar" style="background:#666">${u.nickname.charAt(0)}</div>
        <div class="peer-info" style="flex:1">
          <h4>${sanitizeHTML(u.nickname)}</h4>
        </div>
        <button class="btn btn--sm btn--primary add-friend-btn" data-id="${u.id}">Add</button>
      `;
      
      const btn = item.querySelector('.add-friend-btn');
      btn.onclick = (e) => {
        e.stopPropagation();
        handleAddFriend(u.id, btn);
      };
      
      section.appendChild(item);
    });
  }
  
  container.prepend(section);
}

function removeSearchResults() {
  const old = document.querySelector('.search-results-section');
  if (old) old.remove();
}

async function handleAddFriend(userId, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  try {
    const { error } = await apiSendFriendRequest(currentUser.id, userId);
    if (error) throw error;
    btn.textContent = 'Sent';
    showToast('Request sent!', 'success');
  } catch (err) {
    btn.textContent = 'Add';
    btn.disabled = false;
    showToast('Failed to send', 'error');
  }
}


// --- Friend Actions ---
async function handleAcceptFriendRequest(id, item) {
  try {
    const { error } = await apiAcceptFriendRequest(id);
    if (error) throw error;
    item.remove();
    fetchFriendsAndRequests();
    showToast('Friend added!', 'success');
  } catch (err) { showToast('Error accepting', 'error'); }
}

async function handleDeclineFriendRequest(id, item) {
  try {
    const { error } = await apiDeclineFriendRequest(id);
    if (error) throw error;
    item.remove();
    fetchRequests();
  } catch (err) { showToast('Error declining', 'error'); }
}

async function handleRemoveFriend(fid) {
  showConfirm('Remove Friend', 'Are you sure?', async () => {
    await apiRemoveFriend(currentUser.id, fid);
    toggleMobileChat(false);
    fetchFriends();
    showToast('Friend removed', 'success');
  });
}

async function handleBlockUser(fid) {
  showConfirm('Block User', 'This will block them permanently.', async () => {
    await apiBlockUser(currentUser.id, fid);
    toggleMobileChat(false);
    fetchFriends();
    showToast('User blocked', 'success');
  });
}


// --- Chat Logic ---
function selectFriend(friend) {
  currentChat = friend;
  
  // UI Updates
  document.querySelectorAll('.friend-item').forEach(i => i.classList.remove('active'));
  const activeItem = document.querySelector(`.friend-item[data-id="${friend.id}"]`);
  if (activeItem) activeItem.classList.add('active');
  
  dom.welcomeState.classList.add('hidden');
  dom.chatWindow.classList.remove('hidden');
  
  qs('recipient-name').textContent = friend.nickname;
  qs('recipient-nickname').textContent = '@' + friend.nickname;
  qs('chat-window').querySelector('.recipient-avatar').textContent = friend.nickname.charAt(0).toUpperCase();

  // Mobile Slide
  toggleMobileChat(true);

  // Load Data
  fetchMessages();
  setupMessageSub(friend.id);
}

async function fetchMessages() {
  if (!currentChat) return;
  dom.messagesArea.innerHTML = '<div class="loader-spinner"></div>';
  
  const { data, error } = await apiLoadMessages(currentUser.id, currentChat.id);
  if (error) return;
  
  renderMessages(data || []);
}

function renderMessages(messages) {
  dom.messagesArea.innerHTML = '';
  const frag = document.createDocumentFragment();
  
  messages.forEach(msg => {
     frag.appendChild(createMessageEl(msg));
  });
  
  dom.messagesArea.appendChild(frag);
  scrollToBottom();
}

function createMessageEl(msg) {
  const isMe = msg.sender_id === currentUser.id;
  const el = document.createElement('div');
  el.className = `msg-row ${isMe ? 'me' : ''}`;
  
  const time = new Date(msg.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  
  el.innerHTML = `
    <div class="msg-bubble">
      ${sanitizeHTML(msg.content)}
      <div class="msg-meta">${time}</div>
    </div>
  `;
  return el;
}

async function handleSendMessage(e) {
  e.preventDefault();
  const content = dom.messageInput.value.trim();
  if (!content || !currentChat) return;
  
  // Optimistic UI
  const tempMsg = {
    sender_id: currentUser.id,
    content,
    created_at: new Date().toISOString()
  };
  dom.messagesArea.appendChild(createMessageEl(tempMsg));
  scrollToBottom();
  dom.messageInput.value = '';
  
  const { error } = await apiSendMessage(currentUser.id, currentChat.id, content);
  if (error) showToast('Failed to send', 'error');
}

function scrollToBottom() {
  dom.messagesArea.scrollTop = dom.messagesArea.scrollHeight;
}


// --- Realtime ---
function setupGlobSubscriptions() {
  if (friendRequestSubscription) removeSubscription(friendRequestSubscription);
  friendRequestSubscription = subscribeToFriendRequests(currentUser.id, () => {
    fetchRequests();
    showToast('New friend request!', 'info');
  });
}

function setupMessageSub(chatPartnerId) {
  if (messageSubscription) removeSubscription(messageSubscription);
  
  messageSubscription = subscribeToMessages(currentUser.id, (payload) => {
    if (!payload.new) return;
    const msg = payload.new;
    
    // Only show if it matches current chat
    if (msg.sender_id === chatPartnerId || msg.receiver_id === chatPartnerId) {
       dom.messagesArea.appendChild(createMessageEl(msg));
       scrollToBottom();
    } else {
      showToast('New message', 'info');
    }
  });
}

// --- Utils ---
function showToast(msg, type='info') {
  const t = qs('toast');
  t.textContent = msg;
  t.className = `toast ${type === 'error' ? 'toast-error' : ''}`;
  t.classList.remove('hidden');
  t.style.opacity = 1;
  setTimeout(() => {
    t.style.opacity = 0;
    setTimeout(() => t.classList.add('hidden'), 300);
  }, 3000);
}

function setLoading(btnId, isLoading) {
  const btn = qs(btnId);
  if(!btn) return;
  btn.disabled = isLoading;
  const txt = btn.querySelector('.btn-text');
  const spin = btn.querySelector('.btn-spinner');
  if(txt) txt.classList.toggle('hidden', isLoading);
  if(spin) spin.classList.toggle('hidden', !isLoading);
}

function showConfirm(title, body, onConfirm) {
  const m = qs('confirmation-modal');
  qs('modal-title').textContent = title;
  qs('modal-body').textContent = body;
  
  const btn = qs('modal-confirm');
  const cancel = qs('modal-cancel');
  
  m.classList.remove('hidden');
  
  const close = () => { m.classList.add('hidden'); };
  
  btn.onclick = () => { onConfirm(); close(); };
  cancel.onclick = close;
}

function setupNetworkMonitoring() {
  window.onbg = () => showToast('Offline', 'error');
  window.ononline = () => showToast('Back online!', 'success');
}

function handleNicknameInput(e) { 
  // Simplified debounced check
  const val = e.target.value;
  if (nicknameCheckTimeout) clearTimeout(nicknameCheckTimeout);
  nicknameCheckTimeout = setTimeout(async () => {
    const { data } = await checkNicknameAvailability(val.replace('@',''));
    const status = qs('nickname-availability');
    status.classList.remove('hidden');
    if (data) {
      status.textContent = '❌ Taken';
      status.style.color = 'var(--danger)';
    } else {
      status.textContent = '✅ Available';
      status.style.color = 'var(--success)';
    }
  }, 500);
}

function cleanupAfterLogout() {
  currentUser = null;
  currentChat = null;
  showLanding();
}
