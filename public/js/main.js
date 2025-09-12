// public/js/main.js
const API_BASE = '';
let token = localStorage.getItem('token') || null;
let currentUser = null;
const listEl = document.getElementById('list');
const template = document.getElementById('card-template');

// utility escape
function escapeHtml(s){ return String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// load current user info (if logged in)
async function fetchCurrentUser() {
  if (!token) return null;
  try {
    const res = await fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) { localStorage.removeItem('token'); token = null; return null; }
    const j = await res.json();
    // server returns { user: {...} } or user directly depending on implementation
    currentUser = j.user || j;
    return currentUser;
  } catch (e) {
    localStorage.removeItem('token');
    token = null;
    return null;
  }
}

// render header links + user pill
function renderUserInfo() {
  const ui = document.getElementById('userInfo');
  const authLink = document.getElementById('authLink');
  const historyLink = document.getElementById('historyLink');
  const ownerLink = document.getElementById('ownerLink');

  if (!ui) return;

  // hide role links initially
  if (historyLink) historyLink.classList.add('hidden');
  if (ownerLink) ownerLink.classList.add('hidden');

  ui.innerHTML = '';

  if (!currentUser) {
    // logged out
    if (authLink) {
      ui.appendChild(authLink);
      authLink.textContent = 'Login / Sign Up';
      authLink.href = 'login.html';
      authLink.onclick = null;
    } else {
      ui.innerHTML = `<a id="authLink" href="login.html">Login / Sign Up</a>`;
    }
  } else {
    // build pill: Name · role · idSuffix
    const name = escapeHtml(currentUser.name || currentUser.email || 'User');
    const role = currentUser.role || 'user';
    const idRaw = currentUser._id || currentUser.id || '';
    const idSuffix = idRaw ? String(idRaw).slice(-6) : '';
    const pill = document.createElement('span');
    pill.className = 'user-pill';
    pill.innerHTML = `<span>${name}</span> <span style="opacity:.8">·</span> <span style="font-size:13px">${role}</span>${idSuffix ? `<span class="id-suffix">#${idSuffix}</span>` : ''}`;

    ui.appendChild(pill);

    // show relevant links
    if (role === 'user') {
      if (historyLink) historyLink.classList.remove('hidden');
    } else if (role === 'owner') {
      if (ownerLink) ownerLink.classList.remove('hidden');
    }

    // Logout control (text link)
    const logoutA = document.createElement('a');
    logoutA.href = '#';
    logoutA.textContent = 'Logout';
    logoutA.style.marginLeft = '12px';
    logoutA.style.color = 'inherit';
    logoutA.addEventListener('click', (e) => {
      e.preventDefault();
      localStorage.removeItem('token');
      localStorage.removeItem('user'); // in case you saved it elsewhere
      token = null;
      currentUser = null;
      // reload to update UI
      window.location.reload();
    });
    ui.appendChild(logoutA);
  }
}

function renderTag(text, type='sport'){
  const el = document.createElement('span');
  el.className = 'tag ' + (type === 'sport' ? 'sport' : 'facility');
  el.textContent = text;
  return el;
}

function createCard(ground){
  const t = template.content.cloneNode(true);
  const card = t.querySelector('.card');
  const thumb = t.querySelector('.thumb');
  thumb.src = ground.thumbnail || (ground.images && ground.images[0]) || '/placeholder.png';
  t.querySelector('.title').textContent = ground.title || 'Untitled';
  const priceStr = ground.price && ground.price.amount ? `₹ ${ground.price.amount.toLocaleString()} ${ground.price.negotiable ? '(negotiable)' : '/hr'}` : 'Contact for price';
  t.querySelector('.price').textContent = priceStr;
  t.querySelector('.owner-name').textContent = ground.owner?.name || 'owner';
  t.querySelector('.reviews-count').textContent = Math.floor(Math.random()*50);

  const sportTags = t.querySelector('.tags-sport');
  (ground.tags_sport || []).forEach(s=> sportTags.appendChild(renderTag(s,'sport')));
  const facTags = t.querySelector('.tags-facility');
  (ground.tags_facilities || []).forEach(s=> facTags.appendChild(renderTag(s,'facility')));

  // Update the 'View details' link to a new page
  const btnExpand = t.querySelector('.btn-expand');
  btnExpand.href = `details.html?id=${ground._id}`;
  
  const btnBook = t.querySelector('.btn-book');
  btnBook.addEventListener('click', ()=> startBooking(ground));

  // disable/hide book button for owners (so owners can't book)
  if (currentUser && currentUser.role === 'owner') {
    btnBook.disabled = true;
    btnBook.classList.add('book-disabled');
    btnBook.textContent = 'Owners cannot book';
  }

  return t;
}

async function fetchGrounds(){
  const res = await fetch('/api/grounds');
  return await res.json();
}

async function startBooking(ground){
  if (!token) {
    alert('Please login to book. Redirecting to login page.');
    return window.location.href = 'login.html';
  }
  if (currentUser && currentUser.role === 'owner') {
    return alert('Owners cannot book grounds. Use the Owner portal to manage listings.');
  }

  // determine amount
  const amount = ground.price && ground.price.amount ? ground.price.amount : Number(prompt('Enter booking amount (INR)'));

  // Prepare QR (if available)
  let qrDataUrl = null;
  const upiId = ground.owner?.upiId;
  if (upiId) {
    const qRes = await fetch('/api/upi-qrcode', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ upiId, name: ground.owner?.name, amount, note: `Booking ${ground.title}` })
    });
    const j = await qRes.json();
    if (qRes.ok) qrDataUrl = j.dataUrl;
    else console.warn('QR generation failed', j);
  }

  showBookingModal({ ground, amount, qrDataUrl });
}

/* Modal logic */
function showBookingModal({ ground, amount, qrDataUrl }) {
  const modal = document.getElementById('bookingModal');
  const content = document.getElementById('bookingContent');
  const confirmBtn = document.getElementById('bookingConfirm');
  const cancelBtn = document.getElementById('bookingCancel');
  const closeBtn = document.getElementById('bookingClose');

  // Build content
  content.innerHTML = `
    <div style="text-align:center">
      <h3 style="margin:0 0 6px 0">${escapeHtml(ground.title)}</h3>
      <div style="font-size:14px;color:#666;margin-bottom:8px">Amount: ₹ ${amount}</div>
      ${ qrDataUrl ? `<img src="${qrDataUrl}" alt="UPI QR" style="max-width:260px;border-radius:8px;"/>` : `<div style="padding:14px;background:#f5f5f5;border-radius:8px;color:#333">Owner has not provided UPI. Confirm booking request will be sent without payment proof.</div>` }
      <div style="font-size:13px;color:#888;margin-top:8px">Click "Confirm Booking" to send a booking request to the owner. Owner will confirm and mark slot as booked.</div>
    </div>
  `;

  // open modal
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  function closeModal(){
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm Booking';
    confirmBtn.onclick = null;
    cancelBtn.onclick = null;
    closeBtn.onclick = null;
  }

  cancelBtn.onclick = closeModal;
  closeBtn.onclick = closeModal;

  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Sending...';
    try {
      const resp = await fetch('/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          groundId: ground._id,
          amount,
          from: new Date().toISOString(),
          to: new Date(Date.now() + 60*60*1000).toISOString()
        })
      });
      const j = await resp.json();
      if (resp.ok) {
        alert(j.message || 'Booking request sent to owner.');
        closeModal();
      } else {
        alert(j.message || 'Failed to send booking');
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm Booking';
      }
    } catch (e) {
      alert('Network error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm Booking';
    }
  };
}

// render list (initial)
async function refresh(){
  listEl.innerHTML = '';
  await fetchCurrentUser();
  renderUserInfo(); // update header links + pill
  const grounds = await fetchGrounds();
  const filterSport = document.getElementById('filterSport');
  if (filterSport) {
    const allSports = Array.from(new Set(grounds.flatMap(g => g.tags_sport || [])));
    filterSport.innerHTML = '<option value="">All</option>' + allSports.map(s => `<option value="${s}">${s}</option>`).join('');
  }
  grounds.forEach(g => {
    const node = createCard(g);
    listEl.appendChild(node);
  });
}

document.addEventListener('DOMContentLoaded', ()=>{
  refresh();

  // search / filter handlers
  const search = document.getElementById('search');
  if (search) {
    search.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.card').forEach(c => {
        const title = c.querySelector('.title').textContent.toLowerCase();
        const tags = Array.from(c.querySelectorAll('.tag')).map(t => t.textContent.toLowerCase()).join(' ');
        c.style.display = (title.includes(q) || tags.includes(q)) ? '' : 'none';
      });
    });
  }

  const sort = document.getElementById('sort');
  if (sort) sort.addEventListener('change', ()=> refresh());

  const filter = document.getElementById('filterSport');
  if (filter) filter.addEventListener('change', (e)=>{
    const v = e.target.value;
    document.querySelectorAll('.card').forEach(c => {
      if (!v) c.style.display = '';
      else {
        const sports = Array.from(c.querySelectorAll('.tags-sport .tag')).map(t => t.textContent);
        c.style.display = sports.includes(v) ? '' : 'none';
      }
    });
  });
});