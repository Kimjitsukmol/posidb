// ==========================================
// 🚀 INDEXED DB SETUP
// ==========================================
const DB_NAME = 'POS_DB';
const DB_VERSION = 1;
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        
        req.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains('menu')) database.createObjectStore('menu', { keyPath: 'id' });
            if (!database.objectStoreNames.contains('orders')) database.createObjectStore('orders', { keyPath: 'orderId' });
            if (!database.objectStoreNames.contains('history')) database.createObjectStore('history', { keyPath: 'billId' });
            if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'key' });
        };
        
        req.onsuccess = (e) => { db = e.target.result; resolve(db); };
        req.onerror = (e) => reject(e.target.error);
    });
}

function dbPut(store, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(data);
        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
    });
}

function dbGet(store, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

function dbGetAll(store) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

function dbDelete(store, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
    });
}

// ==========================================
// 📦 GLOBAL VARIABLES
// ==========================================
let menuData = [];
let masterData = [];
let cart = [];
let currentOrders = [];
let currentPayOrder = null;
let historyBills = [];
let lastOrderCount = -1; 

const categories = ['เครื่องดื่ม', 'ขนม/ของว่าง', 'ของใช้ในบ้าน', 'อาหารแห้ง/เครื่องปรุง', 'อาหารสด', 'เบ็ดเตล็ด'];

let isCustomerMode = false;
let customerTable = "";
let isQuickPayMode = false; 
let notifiedOrders = new Set();
let isStoreOpen = true; 
let myLastOrders = [];  

// ==========================================
// ⚙️ CORE UTILS & UI
// ==========================================
function speak(text) { 
    if ('speechSynthesis' in window) { 
        const utterance = new SpeechSynthesisUtterance(text); 
        utterance.lang = 'th-TH'; utterance.rate = 1.0; 
        window.speechSynthesis.speak(utterance); 
    } 
}

function playNotificationSound() { const beep = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg"); beep.play().catch(e=>console.log("Audio blocked", e)); }

function holdBill() {
    if(cart.length === 0) { showToast('ไม่มีรายการให้พักบิล', 'warning'); return; }
    let heldBills = JSON.parse(localStorage.getItem('heldBills') || "[]");
    const newBill = { id: Date.now(), timestamp: new Date().toISOString(), items: cart, total: cart.reduce((sum, i) => sum + (i.price * i.qty), 0) };
    heldBills.push(newBill); localStorage.setItem('heldBills', JSON.stringify(heldBills));
    cart = []; renderCart(); showToast('พักบิลเรียบร้อย (' + heldBills.length + ' รายการ)', 'success');
}

function openRecallModal() {
    const heldBills = JSON.parse(localStorage.getItem('heldBills') || "[]");
    if (heldBills.length === 0) { showToast('ไม่มีบิลที่พักไว้', 'warning'); return; }
    const listContainer = document.getElementById('heldBillsList');
    listContainer.innerHTML = heldBills.map((bill, index) => {
        const timeStr = new Date(bill.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
        return `<div class="bg-white border border-gray-200 rounded-xl p-3 shadow-sm hover:shadow-md transition flex justify-between items-center animate-fade-in"><div class="flex-1 cursor-pointer" onclick="recallBill(${index})"><div class="flex items-center gap-2"><span class="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-0.5 rounded">${timeStr}</span><span class="font-bold text-gray-700">${bill.items.length} รายการ</span></div><div class="text-sm text-gray-500 mt-1">ยอดรวม <span class="text-blue-600 font-bold">${bill.total.toLocaleString()} ฿</span></div></div><button onclick="deleteHeldBill(${index})" class="w-8 h-8 rounded-full bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center ml-2"><i class="fas fa-trash-alt text-xs"></i></button></div>`;
    }).join('');
    document.getElementById('recallModal').classList.remove('hidden');
}

function recallBill(index) {
    let heldBills = JSON.parse(localStorage.getItem('heldBills') || "[]");
    if (cart.length > 0) { if(!confirm("มีรายการค้างอยู่ในตะกร้า ต้องการเคลียร์และเรียกบิลเก่าไหม?")) return; }
    cart = heldBills[index].items; heldBills.splice(index, 1); localStorage.setItem('heldBills', JSON.stringify(heldBills));
    closeModal('recallModal'); renderCart(); showToast('เรียกบิลกลับมาแล้ว', 'success'); 
}

function deleteHeldBill(index) {
    if(!confirm("ต้องการลบบิลนี้ใช่ไหม?")) return;
    let heldBills = JSON.parse(localStorage.getItem('heldBills') || "[]");
    heldBills.splice(index, 1); localStorage.setItem('heldBills', JSON.stringify(heldBills));
    if (heldBills.length === 0) { closeModal('recallModal'); showToast('ลบบิลหมดแล้ว', 'success'); } else { openRecallModal(); }
}

function renderCategoryBar() {
    const bar = document.getElementById('categoryBar');
    bar.innerHTML = `<button onclick="filterMenu('All')" class="cat-btn bg-gradient-to-r from-blue-500 to-blue-400 text-white px-5 py-2 rounded-full shadow-md text-sm font-bold transition transform hover:scale-105 border border-blue-600 shrink-0">ทั้งหมด</button>` + categories.map(c => `<button onclick="filterMenu('${c}')" class="cat-btn bg-white text-gray-600 hover:bg-blue-50 hover:text-blue-600 px-5 py-2 rounded-full shadow-sm text-sm font-medium transition border border-gray-200 shrink-0">${c}</button>`).join('');
}

function populateCategorySelects() {
    const opts = categories.map(c => `<option>${c}</option>`).join('');
    const mCat = document.getElementById('mCategory'); const eCat = document.getElementById('eCategory');
    if(mCat) mCat.innerHTML = opts; if(eCat) eCat.innerHTML = opts;
}

function initDateTime() {
    const weekdays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    const updateTime = () => { 
        const now = new Date(); const dateNum = now.getDate(); const dayName = weekdays[now.getDay()]; 
        const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }); 
        document.getElementById('dateTimeDisplay').innerHTML = `${dateNum} ${dayName} <span class="ml-3 text-white/90">เวลา ${timeStr} น.</span>`; 
    };
    updateTime(); setInterval(updateTime, 1000); 
}

function getDriveUrl(input) {
    if (!input) return '';
    if (input.startsWith('data:image')) return input; 
    let id = input;
    if (input.includes('drive.google.com/thumbnail')) return input;
    if (input.includes('http') || input.includes('google.com')) { const match = input.match(/[-\w]{25,}/); if (match) id = match[0]; }
    return `https://drive.google.com/thumbnail?id=${id}&sz=w200`;
}

// ==========================================
// 💳 PROMPTPAY & QR
// ==========================================
async function initBankQR() {
    const promptPayID = localStorage.getItem('promptPayID');
    const amount = currentPayOrder ? currentPayOrder.totalPrice : 0;
    const imgEl = document.getElementById('bankQRImage');
    const labelEl = document.getElementById('ppLabel'); 
    if (!imgEl) return; 

    if (promptPayID) {
        const payload = generatePayload(promptPayID, amount);
        imgEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${payload}`;
        if (labelEl) labelEl.innerText = `พร้อมเพย์: ${promptPayID}`; 
        return; 
    } 

    try {
        const qrData = await dbGet('settings', 'bankQR');
        if (qrData && qrData.image) {
            imgEl.src = qrData.image; 
            if (labelEl) labelEl.innerText = "สแกนจ่ายเงิน (ภาพที่อัปโหลด)";
            localStorage.setItem('bankQRID', 'local'); 
        } else {
            imgEl.src = "https://placehold.co/400x400?text=Set+PromptPay";
            if (labelEl) labelEl.innerText = "ยังไม่ได้ตั้งค่าพร้อมเพย์";
            localStorage.removeItem('bankQRID');
        }
    } catch(e) {
        console.error("Error fetching Bank QR from DB:", e);
        imgEl.src = "https://placehold.co/400x400?text=Error+Loading";
    }
}

function handleQRClick() {
    const hasPP = localStorage.getItem('promptPayID');
    const hasBankQR = localStorage.getItem('bankQRID');
    if (hasPP) { openPromptPayModal(); } else if (hasBankQR) { openManageQRModal(true); } else { openManageQRModal(false); }
}

function openPromptPayModal() {
    const current = localStorage.getItem('promptPayID') || '';
    document.getElementById('ppInput').value = current; document.getElementById('promptPayModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('ppInput').focus(), 300);
}

function savePromptPayID() {
    const newID = document.getElementById('ppInput').value;
    if (newID) {
        const cleanID = newID.trim().replace(/[^0-9]/g, '');
        if (cleanID.length === 10 || cleanID.length === 13) {
            localStorage.setItem('promptPayID', cleanID); showToast('บันทึก PromptPay แล้ว', 'success'); 
            initBankQR(); closeModal('promptPayModal');
        } else { alert("เบอร์โทรต้องมี 10 หลัก หรือ เลขบัตร 13 หลัก"); }
    } else { clearPromptPayID(); }
}

function clearPromptPayID() {
    localStorage.removeItem('promptPayID'); document.getElementById('ppInput').value = '';
    showToast('ลบ PromptPay แล้ว', 'success'); initBankQR(); closeModal('promptPayModal');
}

function checkAndUseOriginalQR() {
    const savedQR = localStorage.getItem('bankQRID');
    if (savedQR) {
        localStorage.removeItem('promptPayID'); initBankQR();
        showToast('กลับมาใช้รูป QR Code เดิมเรียบร้อย', 'success');
        const imgEl = document.getElementById('bankQRImage');
        if(imgEl) { imgEl.classList.add('opacity-50'); setTimeout(() => imgEl.classList.remove('opacity-50'), 300); }
    } else { showToast('ไม่พบรูป QR Code เดิมในระบบ', 'warning'); speak("ไม่พบรูปเดิมค่ะ"); }
}

function openManageQRModal(hasFile) {
    const modal = document.getElementById('manageQRModal'); const statusText = document.getElementById('mqrStatusText'); const statusIcon = document.getElementById('mqrStatusIcon'); const btnDelete = document.getElementById('btnDeleteQR');
    if (hasFile) {
        statusText.innerText = "พบรูปภาพในระบบ"; statusText.classList.replace('text-gray-500', 'text-green-600');
        statusIcon.innerHTML = '<i class="fas fa-check-circle text-green-500"></i>'; btnDelete.classList.remove('hidden');
    } else {
        statusText.innerText = "ไม่พบรูปภาพในระบบ"; statusText.classList.replace('text-green-600', 'text-gray-500');
        statusIcon.innerHTML = '<i class="fas fa-image"></i>'; btnDelete.classList.add('hidden');
    }
    modal.classList.remove('hidden');
}

async function deleteServerQR() {
    if(!confirm("ต้องการลบรูปภาพใช่หรือไม่?")) return;
    setLoading('btnDeleteQR', true, 'กำลังลบ...');
    try {
        await dbDelete('settings', 'bankQR');
        localStorage.removeItem('bankQRID'); initBankQR(); openManageQRModal(false); showToast('ลบรูปภาพเรียบร้อย', 'success');
    } catch(err) {
        alert('ลบไม่สำเร็จ: ' + err);
    } finally {
        setLoading('btnDeleteQR', false, 'ลบรูปภาพเดิม');
    }
}

function crc16(data) {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) { let x = ((crc >> 8) ^ data.charCodeAt(i)) & 0xFF; x ^= x >> 4; crc = ((crc << 8) ^ (x << 12) ^ (x << 5) ^ x) & 0xFFFF; }
    return ('0000' + crc.toString(16).toUpperCase()).slice(-4);
}

function generatePayload(mobileNumber, amount) {
    const target = mobileNumber.replace(/[^0-9]/g, ''); let targetFormatted = target;
    if (target.length === 10 && target.startsWith('0')) { targetFormatted = '66' + target.substring(1); }
    const merchantIdTag = (targetFormatted.length >= 13) ? '02' : '01'; 
    const merchantInfoValue = '0016A000000677010111' + merchantIdTag + ('00'+targetFormatted.length).slice(-2) + targetFormatted;
    const merchantInfo = '29' + ('00'+merchantInfoValue.length).slice(-2) + merchantInfoValue;
    const country = '5802TH'; const currency = '5303764'; 
    let amountTag = ''; if (amount > 0) { const amtStr = parseFloat(amount).toFixed(2); amountTag = '54' + ('00'+amtStr.length).slice(-2) + amtStr; }
    const version = '000201'; const type = amount > 0 ? '010212' : '010211'; 
    const rawData = version + type + merchantInfo + country + currency + amountTag + '6304';
    return rawData + crc16(rawData);
}

// ==========================================
// ⌨️ SHORTCUTS & INPUT HANDLING
// ==========================================
let lastDotTime = 0; 
function initGlobalShortcuts() {
    document.addEventListener('keydown', function(event) {
        const code = event.code; const key = event.key;
        if (code === 'NumpadAdd' || key === '+' || event.keyCode === 107 || code === 'NumpadDecimal' || key === '.' || event.keyCode === 110) {
            event.preventDefault(); event.stopPropagation(); 
        }
    }, true);

    document.addEventListener('keyup', function(event) {
        const code = event.code; const key = event.key;
        if (code === 'NumpadAdd' || key === '+' || event.keyCode === 107) {
            event.preventDefault(); event.stopPropagation();
            const paymentModal = document.getElementById('paymentModal');
            if (paymentModal && !paymentModal.classList.contains('hidden')) { closeModal('paymentModal'); setTimeout(() => { const searchInput = document.getElementById('searchInput'); if (searchInput) { searchInput.focus(); searchInput.value = ''; } }, 100); } 
            else { const searchInput = document.getElementById('searchInput'); if (searchInput) searchInput.blur(); handleCheckoutClick(); }
            return false;
        }

        if (code === 'NumpadDecimal' || key === '.' || event.keyCode === 110 || event.keyCode === 190) {
            event.preventDefault(); event.stopPropagation();
            const now = Date.now();
            if (now - lastDotTime < 500) { 
                const paymentModal = document.getElementById('paymentModal');
                if (paymentModal && !paymentModal.classList.contains('hidden')) { closeModal('paymentModal'); setTimeout(() => { const searchInput = document.getElementById('searchInput'); if (searchInput) { searchInput.focus(); searchInput.value = ''; } }, 100); } 
                else { const searchInput = document.getElementById('searchInput'); if(searchInput) { searchInput.focus(); searchInput.value = ''; } }
                lastDotTime = 0; 
            } else { lastDotTime = now; }
            return false;
        }
    }, true); 
}

function initQuickAddShortcuts() {
     const mPrice = document.getElementById('mPrice');
     mPrice.addEventListener('keydown', function(event) {
         if (event.key === 'Enter') {
             event.preventDefault();
             const mName = document.getElementById('mName'); const mCode = document.getElementById('mCode');
             if(mName.value.trim() === "") { mName.value = "สินค้าทั่วไป"; }
             if(mPrice.value && mCode.value) {
                 const payload = { id: mCode.value, name: mName.value, price: mPrice.value, category: document.getElementById('mCategory').value, image: "" };
                 sendAddMenu(payload);
             } else { document.getElementById('btnSaveMenu').click(); }
         }
     });
}

function startOrderPolling() { updateKitchenBadge().finally(() => { setTimeout(startOrderPolling, 3000); }); }

function checkMode() {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode'); const table = urlParams.get('table');
    
    if (mode === 'customer') {
        isCustomerMode = true; customerTable = table || "ไม่ระบุ";
        const adminToolbar = document.getElementById('adminToolbar'); if(adminToolbar) adminToolbar.classList.add('hidden');
        const customerToolbar = document.getElementById('customerToolbar'); if(customerToolbar) customerToolbar.classList.remove('hidden');
        const tableDisplay = document.getElementById('customerTableDisplay'); if(tableDisplay) tableDisplay.innerText = customerTable;
        const tableInput = document.getElementById('tableNo');
        if(tableInput) { tableInput.value = customerTable; tableInput.readOnly = true; tableInput.classList.add('bg-gray-100', 'cursor-not-allowed'); }
        const searchInput = document.getElementById('searchInput');
        if (searchInput) { searchInput.placeholder = "พิมพ์ชื่อสินค้าที่ต้องการค้นหา..."; searchInput.setAttribute('inputmode', 'text'); }
        const searchIcon = document.getElementById('topSearchIcon'); if (searchIcon) { searchIcon.className = 'fas fa-search text-blue-500'; }
        const btnToggleKey = document.getElementById('btnToggleKey'); if (btnToggleKey) btnToggleKey.classList.add('hidden');
        const floatingSearch = document.getElementById('floatingSearchContainer'); if (floatingSearch) floatingSearch.classList.add('hidden');
        const holdBillContainer = document.getElementById('holdBillContainer'); if (holdBillContainer) holdBillContainer.classList.add('hidden');
    } else {
        isCustomerMode = false;
        const adminToolbar = document.getElementById('adminToolbar'); if(adminToolbar) adminToolbar.classList.remove('hidden');
        const customerToolbar = document.getElementById('customerToolbar'); if(customerToolbar) customerToolbar.classList.add('hidden');
        const searchInput = document.getElementById('searchInput');
        if (searchInput) { searchInput.placeholder = "ยิงบาร์โค้ด..."; searchInput.setAttribute('inputmode', 'none'); }
        const searchIcon = document.getElementById('topSearchIcon'); if (searchIcon) { searchIcon.className = 'fas fa-barcode text-gray-400'; }
        const btnToggleKey = document.getElementById('btnToggleKey'); if (btnToggleKey) btnToggleKey.classList.remove('hidden');
        const floatingSearch = document.getElementById('floatingSearchContainer'); if (floatingSearch) floatingSearch.classList.remove('hidden');
        const holdBillContainer = document.getElementById('holdBillContainer'); if (holdBillContainer) holdBillContainer.classList.remove('hidden');
    }
}

function openQRModal() { 
    document.getElementById('qrModal').classList.remove('hidden');
    const baseUrl = window.location.href.split('?')[0]; const randomId = Math.floor(Math.random() * 10000); 
    const fullUrl = `${baseUrl}?mode=customer&table=${randomId}`;
    const qrApi = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(fullUrl)}`;
    document.getElementById('qrImage').src = qrApi; document.getElementById('qrLink').href = fullUrl; document.getElementById('qrLink').innerText = fullUrl;
}

// ==========================================
// 🥘 MENU & DB ACTIONS
// ==========================================
async function fetchMenu() {
    const cachedMenu = localStorage.getItem('cachedMenuData');
    if (cachedMenu) { menuData = JSON.parse(cachedMenu); filterMenu('All'); } 
    else { document.getElementById('loadingMenu').classList.remove('hidden'); }
    
    document.getElementById('noResults').classList.add('hidden');
    
    try {
        const data = await dbGetAll('menu');
        menuData = data || [];
        localStorage.setItem('cachedMenuData', JSON.stringify(menuData));
        masterData = [...menuData]; 
        filterMenu('All');
    } catch(e) { console.error("Error fetching menu from DB", e); }
    finally { document.getElementById('loadingMenu').classList.add('hidden'); }
}

function processSearchEnter() {
    const searchInput = document.getElementById('searchInput'); const val = searchInput.value; const trimVal = val.trim();
    if(trimVal) { 
        if (/^[0-9]{1,4}$/.test(trimVal)) { 
            const price = parseInt(trimVal);
            if (price > 0) { addManualItem(price); } else { searchInput.value = ''; }
        } else { scanBarcode(trimVal); } 
    } else { if (cart.length > 0) { updateQty(0, 1); } }
}

function handleSearchKeydown(event) {
    const searchInput = document.getElementById('searchInput'); const paymentModal = document.getElementById('paymentModal');
    if (event.key === '+' || event.code === 'NumpadAdd' || event.key === 'Add' || event.keyCode === 107) {
        event.preventDefault(); 
        if (paymentModal && !paymentModal.classList.contains('hidden')) { closeModal('paymentModal'); setTimeout(() => searchInput.focus(), 100); } 
        else { searchInput.blur(); handleCheckoutClick(); } return;
    }
    if (event.key === '.' || event.code === 'NumpadDecimal' || event.keyCode === 110 || event.keyCode === 190) {
        event.preventDefault(); 
        if (paymentModal && !paymentModal.classList.contains('hidden')) { closeModal('paymentModal'); setTimeout(() => searchInput.focus(), 100); } 
        else { searchInput.value = ''; } return;
    }
    if (event.key === 'Enter' || event.code === 'NumpadEnter' || event.keyCode === 13) { event.preventDefault(); processSearchEnter(); }
    if (searchInput.value === '' && event.key === 'Backspace') { if (cart.length > 0 && cart[0].qty > 1) { updateQty(0, -1); } return; }
}

function checkPaymentEnter(e) { 
    if (e.key === '+' || e.code === 'NumpadAdd' || e.key === 'Add' || e.keyCode === 107) { 
        e.preventDefault(); closeModal('paymentModal'); 
        setTimeout(() => { const searchInput = document.getElementById('searchInput'); if (searchInput) { searchInput.focus(); searchInput.value = ''; } }, 100); return; 
    }
    if (e.key === '.' || e.code === 'NumpadDecimal' || e.key === 'Decimal' || e.keyCode === 110 || e.keyCode === 190) { e.preventDefault(); return; }
    if (e.key === '0' || e.code === 'Numpad0' || e.keyCode === 48 || e.keyCode === 96) { if (e.target.value === '') { e.preventDefault(); return; } }
    
    if (e.key === 'Enter' || e.code === 'NumpadEnter' || e.keyCode === 13) { 
        e.preventDefault(); 
        const inputVal = Number(document.getElementById('inputReceived').value);
        if (inputVal === 0) { 
            setExactMoney(); 
            confirmPayment(); 
            return; 
        }
        if (!document.getElementById('btnConfirmPay').disabled) { 
            confirmPayment(); 
        } else { 
            playNotificationSound(); 
        } 
    } 
}

function addManualItem(price) {
    const manualItem = { id: "MANUAL-" + Date.now(), name: "สินค้าทั่วไป", price: price, category: "เบ็ดเตล็ด", image: "", isHidden: true };
    addItemToCart(manualItem, "-"); document.getElementById('searchInput').value = ''; 
}

function scanBarcode(code) {
    const cleanCode = String(code).trim(); const lowerCode = cleanCode.toLowerCase();
    let item = masterData.find(m => String(m.id).trim() === cleanCode) || menuData.find(m => String(m.id).trim() === cleanCode) || masterData.find(m => m.name.toLowerCase() === lowerCode) || menuData.find(m => m.name.toLowerCase() === lowerCode);
    if(item) { addItemToCart(item, "-"); document.getElementById('searchInput').value = ''; showToast(`เพิ่ม ${item.name} แล้ว`, 'success'); } 
    else { speak("ไม่มี"); playNotificationSound(); openQuickAddModal(cleanCode); }
}

function openQuickAddModal(barcode) {
     openAddMenuModal(); document.getElementById('mCode').value = barcode; document.getElementById('mName').value = ""; document.getElementById('mPrice').value = ""; setTimeout(() => { document.getElementById('mPrice').focus(); }, 300);
}

function searchMenu() { 
    if (document.activeElement && document.activeElement.id === 'searchInput') {
        return; 
    }
    filterMenu('All'); 
}
function clearSearch() { document.getElementById('searchInput').value = ''; searchMenu(); }

function getCategoryEmoji(category) {
    const map = { 'เครื่องดื่ม': '🥤', 'ขนม/ของว่าง': '🍪', 'ของใช้ในบ้าน': '🏠', 'อาหารแห้ง/เครื่องปรุง': '🧂', 'อาหารสด': '🥩', 'เบ็ดเตล็ด': '🛍️' };
    return map[category] || '📦';
}

function filterMenu(category) {
    let rawInput = document.getElementById('searchInput').value.toLowerCase().trim();
    const clearBtn = document.getElementById('clearSearchBtn');
    if(rawInput) clearBtn.classList.remove('hidden'); else clearBtn.classList.add('hidden');

    let searchText = rawInput;
    if (/^[0-9]{1,4}$/.test(rawInput) && parseInt(rawInput) > 0) { searchText = ""; } 

    let dataSource = [];
    if (searchText !== "") {
        const combined = new Map();
        if (masterData.length > 0) { masterData.forEach(m => { if(m.id) combined.set(String(m.id), m); }); }
        menuData.forEach(m => { if(m.id) combined.set(String(m.id), m); });
        dataSource = Array.from(combined.values());
        if (dataSource.length === 0) dataSource = menuData;
    } else { dataSource = menuData; }

    if (category !== 'All' || searchText === '') {
        document.querySelectorAll('.cat-btn').forEach(btn => {
            const isActive = (btn.innerText === category) || (category === 'All' && btn.innerText === 'ทั้งหมด' && searchText === '');
            btn.className = isActive ? "cat-btn bg-gradient-to-r from-blue-500 to-blue-400 text-white px-6 py-2 rounded-full shadow-lg shadow-blue-200 text-sm font-bold transition transform scale-105 border border-blue-500 shrink-0" : "cat-btn bg-white text-gray-500 hover:bg-blue-50 hover:text-blue-600 px-6 py-2 rounded-full shadow-sm text-sm font-medium transition border border-gray-100 shrink-0";
        });
    }

    let filtered = dataSource;
    
    if (!searchText) { 
        filtered = filtered.filter(m => !m.isHidden); 
        filtered = filtered.filter(m => m.image && m.image.trim() !== ""); 
    }

    if (category !== 'All') { filtered = filtered.filter(m => m.category === category); }
    
    if (searchText) {
         filtered = filtered.filter(m => m.name.toLowerCase().includes(searchText) || (m.id && String(m.id).toLowerCase().includes(searchText)) );
         if(category === 'All') { document.querySelectorAll('.cat-btn').forEach(btn => btn.className = "cat-btn bg-white text-gray-600 hover:bg-blue-50 hover:text-blue-600 px-5 py-2 rounded-full shadow-sm text-sm font-medium transition border border-gray-200 shrink-0"); }
    } else if (category === 'All') { 
         filtered.sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category)); 
    }

    const grid = document.getElementById('menuGrid'); const noResults = document.getElementById('noResults');
    if (filtered.length === 0) { grid.classList.add('hidden'); noResults.classList.remove('hidden'); } 
    else {
        grid.classList.remove('hidden'); noResults.classList.add('hidden');
        grid.innerHTML = filtered.map((item) => {
            // ปุ่มแก้ไขสีเดิม
            const editBtnHtml = isCustomerMode ? '' : `<button onclick="handleEditClick('${item.id}', event)" class="absolute top-2 right-2 bg-white/80 hover:bg-white text-gray-400 hover:text-blue-500 w-8 h-8 rounded-full shadow-sm backdrop-blur-sm z-10 flex items-center justify-center transition-all duration-200"><i class="fas fa-pencil-alt text-xs"></i></button>`;
            
            const imageUrl = getDriveUrl(item.image);
            const hasImage = imageUrl && imageUrl.length > 10;
            
            // ไอคอนและพื้นหลังรูปภาพสีเดิม (เทาอ่อน/ขาว)
            let imageHtml = hasImage 
                ? `<img src="${imageUrl}" class="w-full h-full object-contain p-2 transition duration-500 group-hover:scale-110" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');"><div class="hidden w-full h-full bg-gray-50 flex flex-col items-center justify-center select-none text-blue-200"><i class="fas fa-box-open text-4xl mb-2 opacity-50"></i><div class="text-4xl">${getCategoryEmoji(item.category)}</div></div>` 
                : `<div class="w-full h-full bg-gray-50 flex flex-col items-center justify-center select-none text-blue-200 group-hover:bg-blue-50 transition-colors"><i class="fas fa-box-open text-3xl sm:text-4xl mb-2 opacity-30 group-hover:opacity-50 transition-opacity"></i><div class="text-3xl sm:text-4xl filter drop-shadow-sm group-hover:scale-110 transition-transform duration-300">${getCategoryEmoji(item.category)}</div></div>`;

            // นำ w-[85%] ออก เปลี่ยนเป็น w-full เพื่อให้กล่องชิดขอบ และกลับมาใช้สีขาว (bg-white)
            return `
            <div class="w-full bg-white rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer overflow-hidden border border-gray-100 group relative transform hover:-translate-y-1 flex flex-col" onclick="handleAddToCart('${item.id}')">
                ${editBtnHtml}
                
                <div class="w-full aspect-[2/1] sm:aspect-[16/7] bg-white relative overflow-hidden flex items-center justify-center p-1">
                    ${imageHtml}
                </div>
                
                <div class="px-3 py-2.5 flex justify-between items-center bg-gray-50 border-t border-gray-100 shrink-0">
                    <h3 class="font-bold text-gray-700 text-xs sm:text-sm truncate group-hover:text-blue-600 transition-colors flex-1 pr-2" title="${item.name}">${item.name}</h3>
                    <div class="text-blue-600 font-black text-sm sm:text-base whitespace-nowrap drop-shadow-sm">${item.price} ฿</div>
                </div>
            </div>`;
        }).join('');
    }
}

function handleAddToCart(itemId) {
    let item = masterData.find(m => m.id == itemId) || menuData.find(m => m.id == itemId);
    if (item) { 
        addItemToCart(item, "-"); 
        setTimeout(() => { const searchInput = document.getElementById('searchInput'); if (searchInput && typeof isCustomerMode !== 'undefined' && !isCustomerMode) { searchInput.focus(); searchInput.value = ''; } }, 100);
    } else { console.error("Item not found:", itemId); }
}

function handleEditClick(itemId, e) {
    e.stopPropagation(); let item = masterData.find(m => m.id == itemId) || menuData.find(m => m.id == itemId);
    if (item) {
        document.getElementById('editMenuModal').classList.remove('hidden'); 
        document.getElementById('eId').value = item.id; document.getElementById('eName').value = item.name; document.getElementById('ePrice').value = item.price; document.getElementById('eCategory').value = item.category;
    }
}

function toggleCart(show) {
    const panel = document.getElementById('cartPanel'); const mobileBar = document.getElementById('mobileBottomBar');
    if (show) { panel.classList.remove('hidden'); panel.classList.add('flex', 'fixed', 'inset-0', 'z-50'); mobileBar.classList.add('translate-y-[150%]'); } 
    else { if(window.innerWidth < 1024) { panel.classList.add('hidden'); panel.classList.remove('flex', 'fixed', 'inset-0', 'z-50'); if(cart.length > 0) mobileBar.classList.remove('translate-y-[150%]'); } }
}

function addToCart(index) { const item = menuData[index]; addItemToCart(item, "-"); }

function addItemToCart(item, spicy) {
    const existingIndex = cart.findIndex(c => c.id === item.id);
    if (existingIndex !== -1) {
        const existingItem = cart[existingIndex]; existingItem.qty++; cart.splice(existingIndex, 1); cart.unshift(existingItem); speak(existingItem.qty.toString());
    } else { cart.unshift({ ...item, qty: 1, spicy: '-' }); speak(item.price + " บาท"); }
    renderCart(); if(window.navigator.vibrate) window.navigator.vibrate(50);
}

function renderCart() {
    const container = document.getElementById('cartItems'); const totalEl = document.getElementById('totalPrice'); const btnMobile = document.getElementById('btnOrderMobile'); const btnDesktop = document.getElementById('btnOrderDesktop'); const countEl = document.getElementById('cartCountDesktop'); const mobileBar = document.getElementById('mobileBottomBar'); const mobileCount = document.getElementById('mobileCartCount'); const mobileTotal = document.getElementById('mobileCartTotal'); const miniTotal = document.getElementById('miniTotalDisplay'); const changeWrapper = document.getElementById('changeWrapper');
    
    if(cart.length === 0) {
        container.innerHTML = '<div class="h-full flex flex-col items-center justify-center text-gray-400 opacity-60"><i class="fas fa-cash-register text-6xl mb-4 text-blue-200"></i><p>สแกนสินค้า หรือ กดปุ่มเพื่อเปิด QR รับเงิน</p></div>'; countEl.innerText = "0 รายการ"; mobileBar.classList.add('translate-y-[150%]'); 
        if(totalEl) totalEl.innerText = "0"; if(mobileTotal) mobileTotal.innerText = "0 ฿"; if(miniTotal) miniTotal.innerText = "0 ฿";
        if(btnDesktop) { btnDesktop.className = "h-12 bg-gradient-to-b from-gray-400 to-gray-500 text-white font-bold text-lg rounded-lg shadow-sm border-b-4 border-gray-600 transition-all flex flex-col items-center justify-center gap-1 cursor-not-allowed"; btnDesktop.disabled = true; btnDesktop.innerHTML = '<span class="text-xs font-normal opacity-80">ว่าง</span>'; }
        if(btnMobile) { btnMobile.innerHTML = '<span>QR รับเงิน</span> <i class="fas fa-qrcode"></i>'; btnMobile.className = "w-full bg-gradient-to-r from-green-600 to-green-700 text-white font-bold py-3.5 rounded-xl shadow-lg transition flex justify-center items-center gap-2"; }
        return; 
    }
    
    if(changeWrapper) { changeWrapper.classList.add('hidden', 'opacity-0', 'translate-y-4'); changeWrapper.classList.remove('flex', 'opacity-100', 'translate-y-0'); }
    if(totalEl) { totalEl.classList.remove('text-4xl', 'translate-y-[-5px]'); totalEl.classList.add('text-7xl'); }
    
    let btnClassDesktop = ""; let btnHtmlDesktop = ""; let btnHtmlMobile = ""; let btnClassMobile = "";

    if (isCustomerMode) {
        btnClassDesktop = "hidden"; btnHtmlMobile = '<span>ยืนยันรายการ</span> <i class="fas fa-check-circle"></i>'; btnClassMobile = "w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-3.5 rounded-xl shadow-lg transition transform active:scale-95 flex justify-center items-center gap-2";
    } else {
        btnClassDesktop = "h-12 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold text-lg rounded-lg shadow-md border-b-4 border-blue-800 active:border-b-0 active:translate-y-1 transition-all flex flex-col items-center justify-center gap-1"; btnHtmlDesktop = '<span class="text-xs font-normal opacity-80"></span><i class="fas fa-check-circle text-2xl"></i>'; btnHtmlMobile = '<span>คิดเงิน</span> <i class="fas fa-arrow-right"></i>'; btnClassMobile = "w-full bg-gradient-to-r from-blue-500 to-blue-400 hover:from-blue-600 hover:to-blue-500 text-white font-bold py-3.5 rounded-xl shadow-lg transition transform active:scale-95 flex justify-center items-center gap-2";
    }

    if(btnDesktop) { btnDesktop.disabled = false; btnDesktop.className = btnClassDesktop; btnDesktop.innerHTML = btnHtmlDesktop; }
    if(btnMobile) { btnMobile.innerHTML = btnHtmlMobile; btnMobile.className = btnClassMobile; }

    let total = 0; let count = 0;
    container.innerHTML = cart.map((item, idx) => {
        total += item.price * item.qty; count += item.qty;
        return `
        <div onclick="removeFromCart(${idx})" class="flex justify-between items-center bg-blue-50 p-3 sm:p-4 rounded-3xl border border-blue-100 shadow-lg mb-2 animate-fade-in cursor-pointer hover:bg-red-700 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 group">
            <div class="flex-1 min-w-0 pr-3 border-r border-blue-200 group-hover:border-red-600 transition-colors"><div class="text-base font-bold text-gray-800 leading-tight group-hover:text-white transition-colors truncate">${item.name}</div><div class="text-sm text-gray-500 mt-1 group-hover:text-red-100 transition-colors">${item.price.toLocaleString()} บาท</div></div>
            <div class="flex flex-col items-center justify-center px-4"><span class="text-xs text-gray-400 font-medium tracking-wide mb-1 group-hover:text-red-200 transition-colors">จำนวน</span><span class="text-lg font-extrabold text-gray-800 leading-none group-hover:text-white transition-colors">${item.qty}</span></div>
            <div class="flex flex-col items-end justify-center pl-4 border-l border-blue-200 group-hover:border-red-600 transition-colors min-w-[90px]"><span class="text-xs text-gray-400 font-medium tracking-wide mb-1 group-hover:text-red-200 transition-colors">ราคารวม</span><div class="text-lg font-extrabold text-blue-500 leading-none whitespace-nowrap group-hover:text-white transition-colors">${(item.price * item.qty).toLocaleString()} บาท</div></div>
        </div>`;
    }).join('');
    
    const totalTxt = total.toLocaleString() + "";
    totalEl.innerText = totalTxt; countEl.innerText = count + " รายการ"; 
    mobileCount.innerText = count; mobileTotal.innerText = totalTxt + " ฿"; if(miniTotal) miniTotal.innerText = totalTxt + " ฿";
    const isDrawerOpen = !document.getElementById('cartPanel').classList.contains('hidden');
    if (!isDrawerOpen && window.innerWidth < 1024) { mobileBar.classList.remove('translate-y-[150%]'); }
}

function updateQty(idx, change) { 
    cart[idx].qty += change; if(cart[idx].qty > 0) { speak(cart[idx].qty.toString()); } 
    if (cart[idx].qty <= 0) cart.splice(idx, 1); 
    renderCart(); setTimeout(() => { const searchInput = document.getElementById('searchInput'); if (searchInput && typeof isCustomerMode !== 'undefined' && !isCustomerMode) { searchInput.focus(); searchInput.value = ''; } }, 100);
}

function removeFromCart(idx) { 
    cart.splice(idx, 1); renderCart(); 
    setTimeout(() => { const searchInput = document.getElementById('searchInput'); if (searchInput && typeof isCustomerMode !== 'undefined' && !isCustomerMode) { searchInput.focus(); searchInput.value = ''; } }, 100);
}

// ==========================================
// 🛒 CHECKOUT & ORDERS 
// ==========================================
function handleCheckoutClick() { 
    if (cart.length === 0) { quickCheckout(); return; }
    if (isCustomerMode) { isQuickPayMode = false; openConfirmOrderModal(); } else { quickCheckout(); } 
}

function quickCheckout() {
    isQuickPayMode = true;
    const total = cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
    currentPayOrder = { orderId: null, totalPrice: total };
    
    const tableContainer = document.getElementById('quickPayTableNoContainer'); if (tableContainer) tableContainer.classList.add('hidden'); 
    try { initBankQR(); } catch(e) { console.log("QR Init Error", e); }
    const modal = document.getElementById('paymentModal'); if (modal) modal.classList.remove('hidden'); 
    
    const modalTotal = document.getElementById('modalTotalPay');
    if(modalTotal) { modalTotal.innerText = total.toLocaleString(); }
    
    const modalChangeBox = document.getElementById('modalChangeBox');
    if(modalChangeBox) { modalChangeBox.classList.add('opacity-0', 'translate-y-2'); modalChangeBox.innerHTML = `เงินทอน: <span id="modalChangePay" class="text-green-600 text-5xl font-extrabold ml-2 drop-shadow-sm animate-heartbeat">0</span> <span class="ml-1 text-sm">฿</span>`; }

    const inputRec = document.getElementById('inputReceived'); if (inputRec) { inputRec.value = ''; setTimeout(() => { inputRec.focus(); }, 100); }
    const totalPriceEl = document.getElementById('totalPrice'); const changeWrapper = document.getElementById('changeWrapper');
    if (totalPriceEl) { totalPriceEl.classList.remove('text-4xl', 'translate-y-[-10px]'); totalPriceEl.classList.add('text-7xl'); }
    if (changeWrapper) { changeWrapper.classList.add('hidden', 'opacity-0', 'translate-y-4'); changeWrapper.classList.remove('flex', 'opacity-100', 'translate-y-0'); }
    const btnConfirm = document.getElementById('btnConfirmPay'); if (btnConfirm) { btnConfirm.disabled = false; btnConfirm.classList.remove('opacity-50', 'cursor-not-allowed'); }
    if (total > 0) { speak("ยอดรวม " + total + " บาท"); }
    
    // วาดใบเสร็จฝั่งซ้าย
    if(typeof renderPaymentReceipt === 'function') renderPaymentReceipt();
}

function openConfirmOrderModal() {
    document.getElementById('confirmOrderModal').classList.remove('hidden');
    document.getElementById('summaryList').innerHTML = cart.map(i => `<div class="flex justify-between border-b border-gray-200 border-dashed py-2 last:border-0"><span class="text-gray-700 text-sm">${i.name} x${i.qty}</span><span class="font-bold text-gray-800">${i.price*i.qty}</span></div>`).join('') + `<div class="flex justify-between font-bold mt-3 pt-3 border-t text-blue-600 text-lg"><span>รวมทั้งหมด</span><span>${document.getElementById('totalPrice').innerText}</span></div>`;
    
    const typeSelect = document.getElementById('orderType'); const typeDiv = typeSelect.parentElement; const addressSection = document.getElementById('addressSection'); const tableDiv = document.getElementById('tableNo').parentElement; const tableInput = document.getElementById('tableNo');

    if (isCustomerMode) {
        typeSelect.value = "ส่งเดลิเวอรี่"; typeDiv.classList.add('hidden'); tableDiv.classList.add('hidden'); addressSection.classList.add('hidden'); 
        const cName = localStorage.getItem('customerName') || 'ลูกค้า'; const cPhone = localStorage.getItem('customerPhone') || '-'; const savedHouse = localStorage.getItem('customerAddrHouse') || ''; const savedSoi = localStorage.getItem('customerAddrSoi') || '';
        const addressStr = `[ส่งที่: ${savedHouse} ${savedSoi ? 'ซ.' + savedSoi : ''}]`;
        tableInput.value = `${cName} (${cPhone}) ${addressStr}`; document.getElementById('addrHouseNo').value = savedHouse; document.getElementById('addrSoi').value = savedSoi;
    } else {
        typeDiv.classList.remove('hidden'); tableDiv.classList.remove('hidden'); toggleAddressFields(); 
        tableDiv.querySelector('label').innerText = "ชื่อลูกค้า / คิวที่"; tableInput.placeholder = "เช่น 1 หรือ A";
    }
}

function toggleAddressFields() { const type = document.getElementById('orderType').value; const addrSection = document.getElementById('addressSection'); if (type === 'ส่งเดลิเวอรี่') { addrSection.classList.remove('hidden'); } else { addrSection.classList.add('hidden'); } }

async function submitOrder() {
    setLoading('btnSubmitOrder', true, 'กำลังบันทึก...');
    const total = cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
    if (isCustomerMode && total < 100) { setLoading('btnSubmitOrder', false, 'ยืนยันรายการ'); return; }
    if (isCustomerMode) { speak("ยอดรวม " + total.toLocaleString() + " บาท"); }
    
    const orderType = document.getElementById('orderType').value;
    let noteText = document.getElementById('orderNote').value.trim(); 
    let finalTableNo = document.getElementById('tableNo').value; 
    
    if (orderType === 'ส่งเดลิเวอรี่') {
        const houseNo = document.getElementById('addrHouseNo').value.trim(); const soi = document.getElementById('addrSoi').value.trim();
        if (isCustomerMode && (!houseNo || !soi)) { 
             showCustomAlert('ข้อมูลที่อยู่ขาดหาย', 'กรุณารีเฟรชหน้าแล้วกรอกชื่อ/เบอร์ใหม่อีกครั้งค่ะ', '<i class="fas fa-map-marked-alt text-red-500"></i>');
             setLoading('btnSubmitOrder', false, 'ยืนยันรายการ'); return; 
        }
    }

    const orderId = "ORD-" + Date.now();
    const orderData = { 
        orderId: orderId, 
        tableNo: finalTableNo || "หน้าร้าน", 
        orderType: orderType, 
        items: cart.map(i => ({ name: i.name, qty: i.qty, price: i.price, spicy: "-" })), 
        totalPrice: total, 
        note: noteText,
        status: 'Pending',
        timestamp: new Date().toISOString()
    };
    
    try {
        await dbPut('orders', orderData);
        myLastOrders = { items: [...cart], total: total, note: noteText, timestamp: new Date().toISOString() }; 
        showToast('บันทึกรายการขายแล้ว!', 'success'); 
        if (isCustomerMode) { setTimeout(() => speak("ขอบคุณค่ะ"), 1500); } else { speak("บันทึกรายการแล้วค่ะ"); }
        cart = []; renderCart(); toggleCart(false); closeModal('confirmOrderModal'); 
        if(!isCustomerMode) document.getElementById('tableNo').value = '';
        document.getElementById('orderNote').value = ''; document.getElementById('addrHouseNo').value = ''; document.getElementById('addrSoi').value = '';
        if(isCustomerMode) openMyRecentOrder(); 
        updateKitchenBadge();
    } catch(err) {
        showCustomAlert('ผิดพลาด', 'ส่งออเดอร์ไม่สำเร็จ: ' + err, '<i class="fas fa-exclamation-circle text-red-500"></i>');
    } finally {
        setLoading('btnSubmitOrder', false, 'ยืนยันรายการ');
    }
}

async function updateKitchenBadge() { 
    try {
        const allOrders = await dbGetAll('orders');
        const waitingOrders = allOrders.filter(o => o.status !== 'Served' && o.status !== 'Paid'); 
        const waitingCount = waitingOrders.length; 
        const badge = document.getElementById('kitchenBadge'); 
        if (waitingCount > 0) { badge.innerText = waitingCount; badge.classList.remove('hidden'); } else { badge.classList.add('hidden'); } 
        
        if (!isCustomerMode) {
            const isKitchenModalOpen = !document.getElementById('kitchenModal').classList.contains('hidden');
            if (lastOrderCount !== -1 && waitingCount > lastOrderCount) { playNotificationSound(); showToast('มีรายการใหม่เข้ามา!', 'warning'); }
            if (isKitchenModalOpen && waitingCount !== lastOrderCount) { currentOrders = waitingOrders; renderKitchen(currentOrders); }
        }
        lastOrderCount = waitingCount; 
        if (isCustomerMode) { 
            document.getElementById('queueCountDisplay').innerText = waitingCount; 
            const cName = localStorage.getItem('customerName') || 'ลูกค้า'; const cPhone = localStorage.getItem('customerPhone') || '-'; const savedHouse = localStorage.getItem('customerAddrHouse') || ''; const savedSoi = localStorage.getItem('customerAddrSoi') || '';
            const addressStr = `[ส่งที่: ${savedHouse} ${savedSoi ? 'ซ.' + savedSoi : ''}]`;
            const myIdentity = `${cName} (${cPhone}) ${addressStr}`; 
            const myOrders = allOrders.filter(o => o.tableNo === myIdentity);
            myOrders.forEach(order => {
                if (order.status === 'Served' && !notifiedOrders.has(order.orderId)) {
                    document.getElementById('deliveryNotificationModal').classList.remove('hidden');
                    playNotificationSound(); speak("สินค้ากำลังไปส่งค่ะ"); notifiedOrders.add(order.orderId); 
                }
            });
        }
    } catch(e) {}
}

async function openKitchenModal() { document.getElementById('kitchenModal').classList.remove('hidden'); fetchOrders(); }

async function fetchOrders() { 
    const grid = document.getElementById('kitchenGrid'); 
    grid.innerHTML = '<div class="col-span-full text-center py-20"><i class="fas fa-circle-notch fa-spin text-4xl text-blue-500"></i><p class="mt-2 text-gray-400">กำลังโหลดรายการ...</p></div>'; 
    try {
        const allOrders = await dbGetAll('orders');
        currentOrders = allOrders.filter(o => o.status !== 'Paid'); 
        renderKitchen(currentOrders); 
        updateKitchenBadge();
    } catch (err) {
        grid.innerHTML = `<div class="col-span-full text-center text-red-500">Error: ${err}</div>`;
    }
}

function renderKitchen(orders) { 
    const grid = document.getElementById('kitchenGrid'); grid.innerHTML = ''; 
    if(!orders || orders.length === 0) { grid.innerHTML = '<div class="col-span-full flex flex-col items-center justify-center text-gray-300 py-20 animate-fade-in"><i class="fas fa-clipboard-check text-6xl mb-4"></i><p>ไม่มีรายการค้างส่ง</p></div>'; return; } 
    grid.innerHTML = orders.map(order => { 
        const isServed = order.status === 'Served'; const isTakeAway = order.orderType === 'ส่งเดลิเวอรี่'; 
        const cardBorder = isServed ? 'border-green-400' : (isTakeAway ? 'border-red-400' : 'border-blue-400');
        const headerBg = isServed ? 'bg-green-500' : (isTakeAway ? 'bg-red-500' : 'bg-blue-500');
        const bgClass = isServed ? 'bg-green-50' : 'bg-white';
        const timeDiff = Math.floor((new Date() - new Date(order.timestamp)) / 60000);
        let timeAgoText = timeDiff < 1 ? 'เมื่อสักครู่' : `${timeDiff} นาทีที่แล้ว`;
        if(timeDiff > 15 && !isServed) timeAgoText = `<span class="text-red-500 font-bold animate-pulse"><i class="fas fa-exclamation-circle"></i> ${timeAgoText}</span>`;

        return `
        <div class="${bgClass} border-2 ${cardBorder} rounded-2xl shadow-lg relative flex flex-col animate-slide-up overflow-hidden">
            <div class="${headerBg} p-3 text-white flex justify-between items-center shadow-md"><div class="flex items-center gap-3"><div class="bg-white/20 px-3 py-1 rounded-lg text-center min-w-[50px]"><div class="text-[10px] font-bold opacity-80">คิว/โต๊ะ</div><div class="text-2xl font-extrabold leading-none">${order.tableNo}</div></div><span class="text-sm font-bold bg-black/20 px-2 py-0.5 rounded-md border border-white/10">${order.orderType}</span></div><div class="text-right"><div class="font-mono font-bold text-lg leading-none">${new Date(order.timestamp).toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'})}</div><div class="text-[10px] font-medium mt-0.5 opacity-90">${timeAgoText}</div></div></div>
            <div class="p-4 flex-1 flex flex-col gap-3">${order.note ? `<div class="bg-yellow-100 border-l-4 border-yellow-400 text-yellow-900 text-xs p-2 rounded-r font-bold"><i class="fas fa-comment-dots"></i> ${order.note}</div>` : ''}<div class="bg-white rounded-xl border border-gray-200 overflow-hidden"><div class="flex text-[10px] text-gray-500 font-bold bg-gray-100 px-3 py-2 border-b border-gray-200 uppercase tracking-wide"><div class="flex-1">ชื่อสินค้า</div><div class="w-14 text-right">หน่วยละ</div><div class="w-12 text-center">จำนวน</div><div class="w-16 text-right">รวม</div></div><div class="divide-y divide-gray-100 max-h-[250px] overflow-y-auto custom-scrollbar">${(order.items || []).map(i => `<div class="flex items-center px-3 py-2.5 hover:bg-gray-50 transition"><div class="flex-1 font-bold text-gray-700 text-sm pr-2 leading-tight">${i.name}</div><div class="w-14 text-right text-xs text-gray-400 font-mono">${i.price}</div><div class="w-12 text-center"><span class="text-lg font-extrabold text-gray-800">${i.qty}</span></div><div class="w-16 text-right font-bold text-blue-600 text-sm">${(i.price * i.qty).toLocaleString()}</div></div>`).join('')}</div><div class="bg-gray-50 px-3 py-2 border-t border-gray-200 flex justify-between items-center"><span class="text-xs font-bold text-gray-500">ยอดสุทธิ</span><span class="text-lg font-extrabold text-blue-600">${order.totalPrice.toLocaleString()} ฿</span></div></div></div>
            <div class="p-3 bg-gray-50 border-t border-gray-200 flex gap-2">${!isServed ? `<button onclick="markServed('${order.orderId}', this)" class="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2.5 rounded-xl font-bold text-base shadow transition transform active:scale-95"><i class="fas fa-check-circle"></i> จัดเสร็จ</button>` : `<div class="flex-1 text-center text-green-600 font-bold py-2.5 bg-green-100 rounded-xl border border-green-200"><i class="fas fa-check-double"></i> เรียบร้อย</div>`}<button onclick="openPayment('${order.orderId}')" class="flex-1 bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl font-bold text-base shadow transition transform active:scale-95">ชำระเงิน</button></div>
        </div>`; 
    }).join(''); 
}

async function markServed(orderId, btn) { 
    const originalContent = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>'; 
    try {
        const order = await dbGet('orders', orderId);
        if (order) { order.status = "Served"; await dbPut('orders', order); }
        fetchOrders(); showToast('สถานะอัปเดตแล้ว', 'success');
    } catch(e) { btn.disabled = false; btn.innerHTML = originalContent; }
}

function openPayment(orderId) { 
    currentPayOrder = currentOrders.find(o => String(o.orderId) === String(orderId)); 
    if(!currentPayOrder) { showCustomAlert('ผิดพลาด', 'ไม่พบข้อมูลออเดอร์นี้'); return; } 
    cart = JSON.parse(JSON.stringify(currentPayOrder.items)); renderCart(); toggleCart(true); closeModal('kitchenModal');
    isQuickPayMode = false; document.getElementById('quickPayTableNoContainer').classList.add('hidden');
    initBankQR(); document.getElementById('paymentModal').classList.remove('hidden'); 
    
    const totalEl = document.getElementById('modalTotalPay'); 
    if(totalEl) { totalEl.innerText = currentPayOrder.totalPrice.toLocaleString(); }
    const inputRec = document.getElementById('inputReceived'); if(inputRec) { inputRec.value = ''; setTimeout(() => { inputRec.focus(); }, 300); }
    const modalChangeBox = document.getElementById('modalChangeBox'); if(modalChangeBox) { modalChangeBox.classList.add('opacity-0', 'translate-y-2'); const changeTxt = document.getElementById('modalChangePay'); if(changeTxt) changeTxt.innerText = "0"; }
    const btnConfirm = document.getElementById('btnConfirmPay'); if(btnConfirm) { btnConfirm.disabled = false; btnConfirm.classList.remove('opacity-50', 'cursor-not-allowed'); }
    speak("ยอดรวม " + currentPayOrder.totalPrice + " บาท"); setTimeout(() => { document.getElementById('inputReceived').focus(); }, 100);
    
    // วาดใบเสร็จฝั่งซ้าย
    if(typeof renderPaymentReceipt === 'function') renderPaymentReceipt();
}

function addMoney(amount) { const input = document.getElementById('inputReceived'); input.value = Number(input.value) + amount; calcChange(); }
function setExactMoney() { document.getElementById('inputReceived').value = currentPayOrder.totalPrice; calcChange(); }
function clearMoney() { document.getElementById('inputReceived').value = ''; calcChange(); }

let ttsTimer = null;
function calcChange() { 
    const total = currentPayOrder.totalPrice; 
    const inputEl = document.getElementById('inputReceived'); 
    const received = Number(inputEl.value); 
    const change = received - total; 
    const btn = document.getElementById('btnConfirmPay'); 
    const modalChangeBox = document.getElementById('modalChangeBox'); 
    const mainChangeWrapper = document.getElementById('changeWrapper'); 
    const mainChangeText = document.getElementById('mainScreenChange'); 
    const mainTotalEl = document.getElementById('totalPrice'); 
    const modalTotalWrapper = document.getElementById('modalTotalWrapper'); 
    
    // ย่อขนาดราคารวมด้านบนตอนที่เริ่มพิมพ์ตัวเลข
    if (inputEl.value !== '') { 
        if (modalTotalWrapper) modalTotalWrapper.classList.add('scale-50', 'opacity-40', '-translate-y-2'); 
    } else { 
        if (modalTotalWrapper) modalTotalWrapper.classList.remove('scale-50', 'opacity-40', '-translate-y-2'); 
    }
    
    // 1. จัดการหน้าจอหลักด้านหลัง (ซ่อนยอดติดลบสีแดง แสดงเฉพาะตอนมีเงินทอน)
    if(mainChangeWrapper && mainChangeText) {
        if (received >= total && total > 0) {
            mainChangeWrapper.classList.remove('hidden', 'opacity-0', 'translate-y-4'); 
            mainChangeWrapper.classList.add('flex', 'opacity-100', 'translate-y-0');
            if(mainTotalEl) { mainTotalEl.classList.remove('text-7xl'); mainTotalEl.classList.add('text-4xl', 'translate-y-[-5px]'); }
            
            // แสดงเฉพาะยอดเงินทอน (สีเขียว)
            mainChangeText.innerText = change.toLocaleString() + " ฿"; 
            mainChangeText.classList.remove('text-red-500'); 
            mainChangeText.classList.add('text-green-600'); 
        } else {
            // ถ้ายอดเงินยังไม่ถึง ซ่อนให้หมด
            mainChangeWrapper.classList.add('hidden', 'opacity-0', 'translate-y-4'); 
            mainChangeWrapper.classList.remove('flex', 'opacity-100', 'translate-y-0');
            if(mainTotalEl) { mainTotalEl.classList.remove('text-4xl', 'translate-y-[-5px]'); mainTotalEl.classList.add('text-7xl'); }
        }
    }
    
    // 2. จัดการหน้าจอ Modal ชำระเงิน (ซ่อน "ยอดเงินยังขาด" สีแดง แสดงเฉพาะเงินทอน)
    if(received >= total && total > 0) {
        if(modalChangeBox) { 
            modalChangeBox.classList.remove('opacity-0', 'translate-y-2'); 
            modalChangeBox.innerHTML = `<div class="flex flex-col items-center justify-center w-full animate-fade-in text-center transform scale-110 transition-transform duration-500"><span class="text-green-600 text-sm font-bold tracking-wide mb-1">เงินทอน</span><div class="flex items-baseline justify-center gap-2"><span class="text-green-500 text-7xl font-black drop-shadow-md">${change.toLocaleString()}</span><span class="text-green-600 text-4xl font-extrabold">฿</span></div></div>`; 
        }
        clearTimeout(ttsTimer); 
        ttsTimer = setTimeout(() => { if (change > 0) { speak("รับเงิน " + received + " บาท เงินทอน " + change + " บาท"); } }, 800);
    } else { 
        // ถ้ายอดเงินยังขาด ให้ซ่อนกล่องข้อความไปเลย ไม่แสดงตัวเลขสีแดงให้สับสน
        if (modalChangeBox) { 
            modalChangeBox.classList.add('opacity-0', 'translate-y-2'); 
            modalChangeBox.innerHTML = ''; 
        }
    } 
    
    // เปิด/ปิดปุ่มยืนยัน
    if(btn) { btn.disabled = false; btn.classList.remove('opacity-50', 'cursor-not-allowed'); }
    
    // สีกรอบ Input เปลี่ยนเป็นสีเขียวเมื่อรับเงินครบ
    if(received >= total) { 
        inputEl.classList.replace('border-blue-500', 'border-green-500'); 
        inputEl.classList.replace('text-blue-600', 'text-green-600'); 
    } else { 
        inputEl.classList.replace('border-green-500', 'border-blue-500'); 
        inputEl.classList.replace('text-green-600', 'text-blue-600'); 
    }

    if(typeof updateSlipChange === 'function') updateSlipChange();
}

function confirmPayment() { 
    const inputRec = document.getElementById('inputReceived'); let received = Number(inputRec.value); 
    if (!currentPayOrder) { showCustomAlert('Error', 'ข้อมูลผิดพลาด กรุณาปิดหน้าต่างแล้วลองใหม่'); return; }
    const total = currentPayOrder.totalPrice; 
    if (received === 0) { received = total; inputRec.value = total; }
    if (received < total) { showToast('ยอดเงินไม่ครบ', 'warning'); playNotificationSound(); inputRec.classList.add('animate-pulse', 'bg-red-100'); setTimeout(() => inputRec.classList.remove('animate-pulse', 'bg-red-100'), 500); return; }

    const orderId = currentPayOrder.orderId; const finalChange = received - total; 
    closeModal('paymentModal'); const leftPanel = document.getElementById('leftPanel'); if(leftPanel) leftPanel.classList.remove('blur-sm', 'opacity-50', 'pointer-events-none'); speak("ขอบคุณค่ะ");
    if(inputRec) inputRec.value = ''; const modalChangeBox = document.getElementById('modalChangeBox'); if(modalChangeBox) { modalChangeBox.classList.add('opacity-0', 'translate-y-2'); const modalChange = document.getElementById('modalChangePay'); if(modalChange) modalChange.innerText = "0"; }
    
    let payload = {}; let itemsToSave = [];
    if (isQuickPayMode) { 
         itemsToSave = cart.map(i => ({ name: i.name, qty: i.qty, price: i.price })); 
         const quickPayInput = document.getElementById('quickPayTableNo'); let customName = (quickPayInput ? quickPayInput.value : "").trim(); if(!customName) customName = "Walk-in"; 
         payload = { tableNo: customName, finalPrice: total, received: received, change: finalChange, items: itemsToSave, orderType: "ซื้อหน้าร้าน" };
    } else {
        payload = { orderId: orderId, tableNo: currentPayOrder.tableNo, orderType: currentPayOrder.orderType, items: currentPayOrder.items, finalPrice: total, received: received, change: finalChange };
    }

    cart = []; toggleCart(false); renderCart();  
    setTimeout(() => {
        const totalEl = document.getElementById('totalPrice'); const changeWrapper = document.getElementById('changeWrapper'); const mainScreenChange = document.getElementById('mainScreenChange');
        if(totalEl) { totalEl.innerText = total.toLocaleString() + " ฿"; totalEl.classList.remove('text-7xl'); totalEl.classList.add('text-4xl', 'translate-y-[-5px]'); }
        if(changeWrapper && mainScreenChange) { mainScreenChange.innerText = finalChange.toLocaleString() + " ฿"; mainScreenChange.classList.remove('text-red-500'); mainScreenChange.classList.add('text-green-600'); changeWrapper.classList.remove('hidden', 'opacity-0', 'translate-y-4'); changeWrapper.classList.add('flex', 'opacity-100', 'translate-y-0'); }
    }, 50);

    sendPaymentRequest(payload, isQuickPayMode);
    setTimeout(() => {
        if(cart.length === 0) {
             const totalEl = document.getElementById('totalPrice'); const changeWrapper = document.getElementById('changeWrapper');
             if(changeWrapper) { changeWrapper.classList.add('hidden', 'opacity-0', 'translate-y-4'); changeWrapper.classList.remove('flex', 'opacity-100', 'translate-y-0'); }
             if(totalEl) { totalEl.innerText = "0"; totalEl.classList.remove('text-4xl', 'translate-y-[-5px]'); totalEl.classList.add('text-7xl'); }
        }
        const searchInput = document.getElementById('searchInput'); if (searchInput) { searchInput.focus(); searchInput.value = ''; }
    }, 300); 
}

async function sendPaymentRequest(payload, isQuickPay) {
    try {
        const billId = "B" + Date.now();
        const historyData = {
            billId: billId,
            date: new Date().toISOString(),
            table: payload.tableNo,
            type: payload.orderType || 'หน้าร้าน',
            itemSummary: payload.items.map(i => i.name).join(', '),
            items: payload.items,
            total: payload.finalPrice,
            receive: payload.received,
            change: payload.change,
            note: payload.note || ''
        };

        await dbPut('history', historyData);

        if (!isQuickPay && payload.orderId) {
            const order = await dbGet('orders', payload.orderId);
            if (order) { order.status = 'Paid'; await dbPut('orders', order); }
        }
        showToast('ชำระเงินเรียบร้อย', 'success');
        if (!isQuickPay) fetchOrders();
    } catch(err) {
        showCustomAlert('ผิดพลาด', 'บันทึกบิลไม่สำเร็จ: ' + err);
    }
}

// ==========================================
// 📊 REPORTS & HISTORY 
// ==========================================
function openEditMenu(index, e) { e.stopPropagation(); const item = menuData[index]; document.getElementById('editMenuModal').classList.remove('hidden'); document.getElementById('eId').value = item.id; document.getElementById('eName').value = item.name; document.getElementById('ePrice').value = item.price; document.getElementById('eCategory').value = item.category; }
function openAddMenuModal() { document.getElementById('addModal').classList.remove('hidden'); }

// ==========================================
// 📊 สรุปยอดขาย (แก้ไข Timezone ให้ตรง 100%)
// ==========================================
let salesModalTimer = null;
async function openSalesModal() { 
    document.getElementById('salesModal').classList.remove('hidden'); 
    
    document.getElementById('saleToday').innerText = '...'; 
    document.getElementById('saleYest').innerText = '...'; 
    document.getElementById('saleMonth').innerText = '...'; 
    
    if (salesModalTimer) clearTimeout(salesModalTimer);

    try {
        const history = await dbGetAll('history');
        let today = 0, yesterday = 0, month = 0;
        const now = new Date();
        
        // 🔴 สร้างวันที่โดยไม่อิง Timezone Offset ซ้ำซ้อน
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        
        const yestDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
        const yestStr = `${yestDate.getFullYear()}-${String(yestDate.getMonth() + 1).padStart(2, '0')}-${String(yestDate.getDate()).padStart(2, '0')}`;
        
        const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        history.forEach(b => {
            const localBDate = new Date(b.date);
            const bDateStr = `${localBDate.getFullYear()}-${String(localBDate.getMonth() + 1).padStart(2, '0')}-${String(localBDate.getDate()).padStart(2, '0')}`;
            const bMonthStr = `${localBDate.getFullYear()}-${String(localBDate.getMonth() + 1).padStart(2, '0')}`;
            
            if (bDateStr === todayStr) today += parseFloat(b.total || 0);
            if (bDateStr === yestStr) yesterday += parseFloat(b.total || 0);
            if (bMonthStr === monthStr) month += parseFloat(b.total || 0);
        });

        document.getElementById('saleToday').innerText = today.toLocaleString(); 
        document.getElementById('saleYest').innerText = yesterday.toLocaleString(); 
        document.getElementById('saleMonth').innerText = month.toLocaleString(); 
        
        salesModalTimer = setTimeout(() => { closeModal('salesModal'); }, 5000);
    } catch(e) {}
}

async function openHistoryModal() { 
    document.getElementById('historyModal').classList.remove('hidden'); 
    const list = document.getElementById('historyList');
    list.innerHTML = '<tr><td colspan="3" class="text-center p-10 text-gray-400"><i class="fas fa-circle-notch fa-spin text-2xl mb-2"></i><br>กำลังโหลดรายการ...</td></tr>'; 

    try {
        const data = await dbGetAll('history');
        data.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        historyBills = data.slice(0, 200); 
        renderHistoryList(); 
        const badgeCount = document.querySelector('#historyModal h3 span');
        if (badgeCount) {
            badgeCount.innerText = `ล่าสุด ${historyBills.length} บิล`;
        }
    } catch(e) {
        list.innerHTML = '<tr><td colspan="3" class="text-center p-4 text-red-400">โหลดข้อมูลไม่ได้</td></tr>'; 
    }
}

function renderHistoryList() {
    const list = document.getElementById('historyList');
    if(!historyBills || historyBills.length === 0) { list.innerHTML = '<tr><td colspan="3" class="text-center p-10 text-gray-300">ไม่พบประวัติการขาย</td></tr>'; return; }
    list.innerHTML = historyBills.map((b, index) => {
        let dateStr = "-"; let timeStr = "-";
        try { const d = new Date(b.date); dateStr = d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' }); timeStr = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); } catch(e) {}
        return `<tr onclick="openBillDetail(${index})" class="hover:bg-blue-50 transition duration-150 cursor-pointer group border-b border-gray-100 last:border-0"><td class="p-3 font-mono align-top pt-3 group-hover:text-blue-600"><div class="text-[10px] text-gray-400 font-bold leading-none mb-1">${dateStr}</div><div class="text-sm font-bold text-gray-700">${timeStr}</div></td><td class="p-3 text-gray-700 align-top pt-3"><span class="line-clamp-1 leading-relaxed font-medium group-hover:text-blue-800">${b.itemSummary}</span><span class="text-[10px] text-gray-400 block mt-0.5 group-hover:text-blue-400">ID: ${b.billId}</span></td><td class="p-3 text-right font-bold text-gray-800 align-top pt-3 whitespace-nowrap text-base group-hover:text-blue-600">${parseFloat(b.total).toLocaleString()}</td></tr>`; 
    }).join(''); 
}

function openBillDetail(index) {
    const bill = historyBills[index]; 
    if (!bill) return;

    // จัดการวันที่และเวลา
    const d = new Date(bill.date); 
    const dateStr = d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }); 
    const timeStr = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // จัดการข้อมูลลูกค้าและที่อยู่
    const tableNo = bill.table || 'N/A'; 
    const customerMatch = tableNo.match(/(.*)\s*\((.*?)\)\s*(\[ส่งที่:\s*.*\])?/); 
    const customerName = customerMatch ? customerMatch[1].trim() : tableNo; 
    const customerPhone = customerMatch && customerMatch[2] ? customerMatch[2].trim() : ''; 
    const customerAddress = customerMatch && customerMatch[3] ? customerMatch[3] : '';
    
    let totalQty = 0;
    let itemCount = bill.items.length;
    
    // สร้าง HTML สำหรับรายการสินค้า
    const itemsHtml = bill.items.map(item => {
        totalQty += item.qty;
        const itemTotal = item.price * item.qty;
        return `
        <div class="leading-tight mb-1">
            <div class="break-words">${item.qty} ${item.name}</div>
            <div class="flex justify-end gap-2 mt-0.5">
                <span class="w-14 text-right">${item.price.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
                <span class="w-16 text-right">${itemTotal.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
            </div>
        </div>`;
    }).join('');

    const content = document.getElementById('billDetailContent');
    content.innerHTML = `
        <div class="flex-1 overflow-y-auto bg-gray-100 p-4 custom-scrollbar flex flex-col items-center justify-start relative">
            
            <button onclick="closeModal('billDetailModal')" class="absolute top-4 right-4 bg-white hover:bg-red-50 text-gray-400 hover:text-red-500 w-9 h-9 rounded-full flex items-center justify-center transition-all shadow-sm z-20 active:scale-95 border border-gray-200">
                <i class="fas fa-times text-lg"></i>
            </button>

            <div class="bg-white w-full max-w-[280px] text-gray-800 text-[11px] shadow-sm p-4 pb-6 relative font-mono shrink-0 mb-5 mt-8">
                <div class="text-center mb-3">
                    <h3 class="font-bold text-[14px]">ร้านเจ้พินขายของชำ</h3>
                    <p>29/30 บ่อวิน ศรีราชา ชลบุรี 20230</p>
                    <p class="mt-2 font-bold text-[13px]">ใบเสร็จรับเงิน</p>
                </div>
                
                <div class="mb-2 space-y-0.5">
                    <div class="flex gap-2"><span>เลขที่:</span> <span>${bill.billId}</span></div>
                    <div class="flex gap-2"><span>วันที่:</span> <span>${dateStr} ${timeStr}</span></div>
                    ${customerName && customerName !== 'Walk-in' && customerName !== 'หน้าร้าน' ? `<div class="flex gap-2 mt-1"><span class="shrink-0">ลูกค้า:</span> <span class="break-words">${customerName} ${customerPhone}</span></div>` : ''}
                    ${customerAddress ? `<div class="flex gap-2"><span class="shrink-0">ที่อยู่:</span> <span class="break-words">${customerAddress.replace(/\[ส่งที่:\s*|\]/g, '').trim()}</span></div>` : ''}
                    ${bill.note ? `<div class="flex gap-2"><span class="shrink-0">หมายเหตุ:</span> <span class="break-words">${bill.note}</span></div>` : ''}
                </div>
                
                <div class="border-t border-b border-gray-800 py-1 mb-2 flex font-bold">
                    <div class="flex-1 text-center">รายการ</div>
                    <div class="w-14 text-right">หน่วยละ</div>
                    <div class="w-16 text-right">รวมเงิน</div>
                </div>
                
                <div class="space-y-1.5 mb-2 min-h-[50px]">
                    ${itemsHtml}
                </div>
                
                <div class="border-t border-gray-800 pt-1 pb-1">
                    <div class="flex gap-4">
                        <span>รายการ: <span>${itemCount}</span></span>
                        <span>จำนวนชิ้น: <span>${totalQty}</span></span>
                    </div>
                </div>
                
                <div class="border-t border-gray-800 pt-1 space-y-1">
                    <div class="flex justify-between font-bold">
                        <span>รวมเป็นเงิน</span>
                        <span>${parseFloat(bill.total).toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
                    </div>
                    <div class="flex justify-between font-bold text-[13px] mt-1">
                        <span>รวมทั้งสิ้น</span>
                        <span>${parseFloat(bill.total).toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
                    </div>
                </div>
                
                <div class="border-t border-gray-800 pt-1 mt-2 flex justify-between">
                    <span>รับเงิน <span>${parseFloat(bill.receive || bill.total).toLocaleString('th-TH', {minimumFractionDigits: 2})}</span></span>
                    <span>เงินทอน <span>${parseFloat(bill.change || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</span></span>
                </div>
                
                <div class="text-center mt-6 pt-2">
                    <p>ขอบคุณที่ใช้บริการ</p>
                </div>

                <div class="absolute bottom-0 left-0 right-0 h-2 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxwb2x5Z29uIGZpbGw9IiNmM2Y0ZjYiIHBvaW50cz0iMCA4IDQgMCA4IDgiLz48L3N2Zz4=')]"></div>
            </div>

            <div class="w-full max-w-[280px] flex gap-2 shrink-0 pb-4">
                <button onclick="printReceiptFromIndex(${index})" class="bg-blue-500 hover:bg-blue-600 text-white w-1/4 py-3 rounded-xl text-lg font-bold transition shadow-md flex justify-center items-center active:scale-95"><i class="fas fa-print"></i></button>
                <button onclick="confirmDeleteBill('${bill.billId}')" class="bg-red-600 hover:bg-red-700 text-white w-1/4 py-3 rounded-xl text-lg font-bold transition shadow-md flex justify-center items-center active:scale-95"><i class="fas fa-trash-alt"></i></button>
                <button onclick="closeModal('billDetailModal')" class="flex-1 bg-gray-800 hover:bg-gray-900 text-white py-3 rounded-xl font-bold transition shadow-md active:scale-95">ปิดหน้าต่าง</button>
            </div>
            
        </div>
    `;
    
    document.getElementById('billDetailModal').classList.remove('hidden');
}

function confirmDeleteBill(billId) { document.getElementById('deleteBillIdTarget').value = billId; document.getElementById('deleteBillModal').classList.remove('hidden'); }

async function executeDeleteBill() {
    const billId = document.getElementById('deleteBillIdTarget').value;
    closeModal('deleteBillModal'); closeModal('billDetailModal'); closeModal('historyModal');
    try {
        await dbDelete('history', billId);
        showToast('ลบบิลเรียบร้อยแล้ว', 'success'); 
    } catch(err) {
        showCustomAlert('ผิดพลาด', 'ไม่สามารถลบบิลได้', '<i class="fas fa-exclamation-circle text-red-500"></i>'); 
    }
}

function printReceipt(bill) {
    let items = bill.items; if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }
    let itemsHtml = items.map(i => `<tr><td style="text-align: left; padding: 2px 0;">${i.name}<br><span style="font-size: 10px; color: #666;">x${i.qty}</span></td><td style="text-align: right; vertical-align: top; padding: 2px 0;">${(i.price * i.qty).toLocaleString()}</td></tr>`).join('');
    const printWindow = window.open('', '', 'width=300,height=600');
    const receiptHtml = `<html><head><title>Print Receipt</title><style>body { font-family: 'Courier New', monospace; margin: 0; padding: 10px; width: 58mm; color: #000; font-size: 12px; } .header { text-align: center; margin-bottom: 10px; } .store-name { font-size: 16px; font-weight: bold; margin-bottom: 5px; } .divider { border-top: 1px dashed #000; margin: 5px 0; } table { width: 100%; border-collapse: collapse; } .total-section { margin-top: 10px; font-weight: bold; font-size: 14px; } .footer { text-align: center; margin-top: 15px; font-size: 10px; } @media print { @page { margin: 0; size: 58mm auto; } body { margin: 0; } }</style></head><body><div class="header"><div class="store-name">ร้านเจ้พิน ขายของชำ</div><div>ใบเสร็จรับเงิน</div></div><div class="divider"></div><div style="font-size: 10px;"><div>วันที่: ${new Date(bill.date).toLocaleString('th-TH')}</div><div>Bill ID: ${bill.billId}</div><div>ลูกค้า: ${bill.table} (${bill.type})</div></div><div class="divider"></div><table>${itemsHtml}</table><div class="divider"></div><table><tr class="total-section"><td style="text-align: left;">รวมทั้งสิ้น</td><td style="text-align: right;">${parseFloat(bill.total).toLocaleString()}</td></tr><tr style="font-size: 11px;"><td style="text-align: left;">รับเงิน</td><td style="text-align: right;">${parseFloat(bill.receive || bill.total).toLocaleString()}</td></tr><tr style="font-size: 11px;"><td style="text-align: left;">เงินทอน</td><td style="text-align: right;">${parseFloat(bill.change || 0).toLocaleString()}</td></tr></table><div class="footer">ขอบคุณที่อุดหนุนครับ/ค่ะ<br>Powered by ICE KANJANAWAT POS</div><script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 100); }<\/script><\/body><\/html>`;
    printWindow.document.write(receiptHtml); printWindow.document.close();
}
function printReceiptFromIndex(index) { const bill = historyBills[index]; if(bill) { printReceipt(bill); } else { showCustomAlert('Error', 'ไม่พบข้อมูลบิล'); } }

// ==========================================
// ✏️ EDIT & ADD MENU 
// ==========================================
document.getElementById('editMenuForm').addEventListener('submit', async function(e) { 
    e.preventDefault(); 
    setLoading('btnEditSave', true, 'กำลังบันทึก...'); 
    const id = document.getElementById('eId').value;
    try {
        const item = await dbGet('menu', id);
        if (item) {
            item.name = document.getElementById('eName').value;
            item.price = parseFloat(document.getElementById('ePrice').value);
            item.category = document.getElementById('eCategory').value;
            await dbPut('menu', item);
            showToast('แก้ไขสำเร็จ', 'success'); 
            closeModal('editMenuModal'); 
            fetchMenu();
        }
    } catch(err) {
        showCustomAlert('Error', 'ไม่สามารถบันทึกได้');
    } finally {
        setLoading('btnEditSave', false, 'บันทึก');
    }
});

function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = event => { const img = new Image(); img.src = event.target.result; img.onload = () => { const canvas = document.createElement('canvas'); let width = img.width; let height = img.height; if (width > height) { if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; } } else { if (height > maxWidth) { width *= maxWidth / height; height = maxWidth; } } canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height); resolve(canvas.toDataURL('image/jpeg', quality)); }; img.onerror = error => reject(error); }; reader.onerror = error => reject(error);
    });
}

document.getElementById('addMenuForm').addEventListener('submit', function(e) { 
    e.preventDefault(); 
    const fileInput = document.getElementById('mFile'); const file = fileInput.files[0]; const mCode = document.getElementById('mCode').value.trim();
    if (file) {
         setLoading('btnSaveMenu', true, 'กำลังบีบอัดรูป...'); 
         compressImage(file, 800, 0.7).then(async compressedBase64 => {
            setLoading('btnSaveMenu', true, 'กำลังอัปโหลด...'); 
            const payload = { id: mCode, name: document.getElementById('mName').value, price: document.getElementById('mPrice').value, category: document.getElementById('mCategory').value, image: compressedBase64 };
            await sendAddMenu(payload);
        }).catch(err => { console.error(err); setLoading('btnSaveMenu', false, 'บันทึก'); showCustomAlert('Error', 'ไม่สามารถประมวลผลรูปภาพได้'); });
    } else {
         const payload = { id: mCode, name: document.getElementById('mName').value, price: document.getElementById('mPrice').value, category: document.getElementById('mCategory').value, image: "" };
         sendAddMenu(payload);
    }
});

function uploadBankQRFile(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0]; const reader = new FileReader(); const imgEl = document.getElementById('bankQRImage'); const originalSrc = imgEl.src; imgEl.style.opacity = '0.5';
        reader.onload = function(e) {
              const base64Preview = e.target.result; imgEl.src = base64Preview;
              compressImage(file, 600, 0.7).then(async compressedBase64 => {
                  try {
                      await dbPut('settings', { key: 'bankQR', image: compressedBase64 });
                      localStorage.setItem('bankQRID', 'local'); localStorage.removeItem('promptPayID'); 
                      showToast('อัปโหลด QR Code สำเร็จ', 'success'); initBankQR(); closeModal('manageQRModal');
                  } catch(err) {
                      imgEl.src = originalSrc; showCustomAlert('Error', 'อัปโหลดไม่สำเร็จ: ' + err);
                  } finally {
                      imgEl.style.opacity = '1';
                  }
              });
        }; reader.readAsDataURL(file);
    }
}

async function sendAddMenu(payload) {
     setLoading('btnSaveMenu', false, 'บันทึก'); 
     const tempId = payload.id || ("P" + Date.now()); 
     const newItem = { id: tempId, name: payload.name, price: parseFloat(payload.price), category: payload.category || 'ทั่วไป', image: payload.image || '', spicy: '-', isHidden: false };
     
     addItemToCart(newItem, "-"); 
     document.getElementById('searchInput').value = ''; closeModal('addModal'); 
     setTimeout(() => { const searchInput = document.getElementById('searchInput'); if (searchInput) { searchInput.focus(); searchInput.value = ''; } }, 100);
     
     menuData.push(newItem); masterData.push(newItem);
     const activeCategoryBtn = document.querySelector('.cat-btn.bg-gradient-to-r'); const currentCat = activeCategoryBtn ? activeCategoryBtn.innerText : 'All'; filterMenu(currentCat === 'ทั้งหมด' ? 'All' : currentCat);
     document.getElementById('addMenuForm').reset(); 

     try {
         await dbPut('menu', newItem);
     } catch(err) {
         showCustomAlert('ผิดพลาด', 'บันทึกสินค้าลงฐานข้อมูลไม่สำเร็จ', '<i class="fas fa-exclamation-circle text-red-500"></i>'); 
     }
}

async function confirmDeleteMenu() { 
    setLoading('btnDeleteMenu', true, 'ลบ...'); 
    try {
        await dbDelete('menu', document.getElementById('eId').value);
        showToast('ลบสินค้าแล้ว', 'success'); closeModal('editMenuModal'); fetchMenu(); 
    } catch(err) {
        showCustomAlert('ผิดพลาด', 'ลบสินค้าไม่สำเร็จ', '<i class="fas fa-exclamation-circle text-red-500"></i>');
    } finally {
        setLoading('btnDeleteMenu', false, 'ลบ');
    }
}
function deleteMenu() { openConfirmActionModal('ยืนยันการลบสินค้า', 'คุณแน่ใจหรือไม่ที่จะลบสินค้านี้? การกระทำนี้ไม่สามารถย้อนกลับได้', '<i class="fas fa-trash-alt"></i>', confirmDeleteMenu); }
function openConfirmActionModal(title, msg, iconHtml, confirmHandler) { document.getElementById('confirmActionTitle').innerText = title; document.getElementById('confirmActionMsg').innerText = msg; document.getElementById('confirmActionIcon').innerHTML = iconHtml; const confirmBtn = document.getElementById('btnConfirmAction'); confirmBtn.onclick = () => { closeModal('confirmActionModal'); confirmHandler(); }; document.getElementById('confirmActionModal').classList.remove('hidden'); }

function closeModal(id) { 
    document.getElementById(id).classList.add('hidden'); 
    if (id === 'paymentModal') { const leftPanel = document.getElementById('leftPanel'); if(leftPanel) leftPanel.classList.remove('blur-sm', 'opacity-50', 'pointer-events-none'); const modalTotalWrapper = document.getElementById('modalTotalWrapper'); if (modalTotalWrapper) { modalTotalWrapper.classList.remove('scale-50', 'opacity-40', '-translate-y-2'); } }
    setTimeout(() => { const searchInput = document.getElementById('searchInput'); if (searchInput && typeof isCustomerMode !== 'undefined' && !isCustomerMode) { searchInput.focus(); searchInput.value = ''; } }, 100);
}

function showToast(msg, type='success') { const toast = document.getElementById('toast'); const iconContainer = toast.querySelector('div:first-child'); const icon = iconContainer.querySelector('i'); if (type === 'warning') { toast.classList.remove('border-green-500'); toast.classList.add('border-yellow-500'); iconContainer.classList.replace('bg-green-100', 'bg-yellow-100'); icon.classList.replace('text-green-600', 'text-yellow-600'); icon.className = 'fas fa-bell'; } else { toast.classList.add('border-green-500'); toast.classList.remove('border-yellow-500'); iconContainer.classList.replace('bg-yellow-100', 'bg-green-100'); icon.classList.replace('text-yellow-600', 'text-green-600'); icon.className = 'fas fa-check'; } document.getElementById('toastMsg').innerText = msg; toast.style.transform = 'translateX(0)'; setTimeout(() => { toast.style.transform = 'translateX(150%)'; }, 3000); }
function showCustomAlert(title, msg, icon='<i class="fas fa-info-circle text-blue-500"></i>') { document.getElementById('alertTitle').innerText = title; document.getElementById('alertMsg').innerText = msg; document.getElementById('alertIcon').innerHTML = icon; document.getElementById('customAlert').classList.remove('hidden'); }
function closeCustomAlert() { document.getElementById('customAlert').classList.add('hidden'); }
function setLoading(btnId, isLoading, text) { const btn = document.getElementById(btnId); let span = btn.querySelector('.btn-text'); let icon = btn.querySelector('i.fas'); if (!span && btnId === 'btnDeleteMenu') { if (btn.innerHTML.indexOf('<span class="btn-text">') === -1) { const originalText = btn.innerText; btn.innerHTML = `<span class="btn-text">${originalText}</span> <i class="fas fa-trash-alt"></i>`; } span = btn.querySelector('.btn-text'); icon = btn.querySelector('i.fas'); } else if (!span && btnId !== 'btnDeleteMenu') { if (btn.innerHTML.indexOf('<span class="btn-text">') === -1) { const originalText = btn.innerText; btn.innerHTML = `<span class="btn-text">${originalText}</span> <i class="fas fa-save"></i>`; } span = btn.querySelector('.btn-text'); icon = btn.querySelector('i.fas'); } if(isLoading) { btn.disabled = true; btn.classList.add('opacity-75', 'cursor-not-allowed'); if(span && !span.dataset.originalText) { span.dataset.originalText = span.innerText; } if(span) span.innerText = text; if(icon && !icon.dataset.originalClass) { icon.dataset.originalClass = icon.className; } if(icon) { icon.className = "fas fa-circle-notch fa-spin"; } } else { btn.disabled = false; btn.classList.remove('opacity-75', 'cursor-not-allowed'); if(span && span.dataset.originalText) { span.innerText = span.dataset.originalText; delete span.dataset.originalText; span.removeAttribute('data-original-text'); } if(icon && icon.dataset.originalClass) { icon.className = icon.dataset.originalClass; delete icon.dataset.originalClass; icon.removeAttribute('data-original-class'); } } }

// ==========================================
// 🏬 STORE STATUS
// ==========================================
async function initStoreStatus() {
    try {
        const status = await dbGet('settings', 'storeStatus');
        isStoreOpen = status ? status.isOpen : true; 
        updateStoreUI(); 
        if (isCustomerMode && !isStoreOpen) { document.getElementById('storeClosedModal').classList.remove('hidden'); }
    } catch(e) {}
}

async function toggleStoreStatus() {
    if (isCustomerMode) return; 
    const newStatus = !isStoreOpen; isStoreOpen = newStatus; updateStoreUI();
    try {
        await dbPut('settings', { key: 'storeStatus', isOpen: newStatus });
        showToast(isStoreOpen ? 'เปิดรับออเดอร์แล้ว' : 'ปิดรับออเดอร์แล้ว', 'success');
    } catch(e) {
        isStoreOpen = !newStatus; updateStoreUI(); showToast('เปลี่ยนสถานะไม่สำเร็จ', 'warning');
    }
}

function updateStoreUI() {
    const bg = document.getElementById('storeToggleBg'); const dot = document.getElementById('storeToggleDot'); const text = document.getElementById('storeStatusText');
    if (isStoreOpen) { bg.className = "w-10 h-5 rounded-full relative transition-colors duration-300 shadow-inner flex items-center bg-green-500"; dot.style.transform = "translateX(20px)"; text.innerText = "เปิด"; } else { bg.className = "w-10 h-5 rounded-full relative transition-colors duration-300 shadow-inner flex items-center bg-red-500"; dot.style.transform = "translateX(0px)"; text.innerText = "ปิด"; }
}

function openMyRecentOrder() {
    const modal = document.getElementById('myOrderModal'); const content = document.getElementById('myOrderContent');
    if (myLastOrders && myLastOrders.items && myLastOrders.items.length > 0) { 
        const total = myLastOrders.total; const orderNote = myLastOrders.note || ''; 
        let addressString = "ไม่ระบุ"; let remainingNote = orderNote; const addressMatch = orderNote.match(/\[ส่งที่:\s*(.*?)\]/); 
        if (addressMatch && addressMatch[1]) { addressString = addressMatch[1]; remainingNote = orderNote.replace(addressMatch[0], '').trim(); }
        const cName = localStorage.getItem('customerName') || 'ลูกค้า'; const cPhone = localStorage.getItem('customerPhone') || '-';

        let html = `<div class="text-center mb-6"><h3 class="text-xl font-extrabold text-blue-600 mb-1">ใบเสร็จรับเงิน (ออเดอร์ล่าสุด)</h3><p class="text-xs text-gray-500">ขอบคุณที่ใช้บริการค่ะ</p></div><div class="bg-gray-50 p-4 rounded-xl mb-4 border border-gray-200 shadow-inner"><div class="font-bold text-sm text-gray-700 mb-2 border-b pb-2 border-dashed"><i class="fas fa-user-tag mr-2 text-blue-500"></i> ผู้สั่ง: ${cName} <span class="text-xs text-gray-500">(${cPhone})</span></div><div class="text-sm text-gray-600"><i class="fas fa-map-marker-alt mr-2 text-red-500"></i>ที่อยู่จัดส่ง: <span class="font-bold">${addressString}</span></div>${remainingNote ? `<div class="text-xs text-gray-500 mt-2 pt-2 border-t border-dashed">หมายเหตุ: ${remainingNote}</div>` : ''}<div class="text-xs text-gray-500 mt-2 pt-2 border-t">เวลาสั่ง: ${new Date(myLastOrders.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</div></div><div class="space-y-3">`;

        myLastOrders.items.forEach(item => { const itemTotal = item.price * item.qty; html += `<div class="flex justify-between items-center bg-white p-3 rounded-xl border border-gray-200 shadow-sm"><div><h4 class="font-bold text-gray-700">${item.name}</h4><div class="text-xs text-gray-500">${item.price} x ${item.qty}</div></div><div class="font-bold text-blue-600">${itemTotal.toLocaleString()} ฿</div></div>`; });
        
        html += `</div><div class="mt-4 pt-4 border-t border-dashed border-gray-300 flex justify-between items-center"><span class="text-gray-600 font-bold">รวมทั้งหมด</span><span class="text-2xl font-bold text-blue-600">${total.toLocaleString()} ฿</span></div><div class="mt-6 text-center"><p class="text-green-600 font-bold text-sm mb-2"><i class="fas fa-check-circle"></i> ทางร้านได้รับออเดอร์แล้ว</p><button onclick="closeModal('myOrderModal')" class="bg-gray-800 text-white w-full py-3 rounded-xl font-bold hover:bg-gray-900 transition">ปิดหน้าต่าง</button></div>`;
        content.innerHTML = html;
    } else { content.innerHTML = '<div class="text-center py-10"><i class="fas fa-shopping-basket text-4xl text-gray-300 mb-2"></i><p class="text-gray-400">ยังไม่มีรายการที่สั่งล่าสุด</p></div>'; }
    modal.classList.remove('hidden');
}

function checkLoginStatus() {
    const urlParams = new URLSearchParams(window.location.search);
    const isCustomer = urlParams.get('mode') === 'customer';
    if (isCustomer || (typeof isCustomerMode !== 'undefined' && isCustomerMode)) { checkCustomerIdentity(); }
    initStoreStatus(); 
}

function checkCustomerIdentity() {
    const savedName = localStorage.getItem('customerName'); const savedPhone = localStorage.getItem('customerPhone'); const savedHouseNo = localStorage.getItem('customerAddrHouse'); const savedSoi = localStorage.getItem('customerAddrSoi');
    if (!savedName || !savedPhone || !savedHouseNo || !savedSoi) { 
        document.getElementById('customerIdentityModal').classList.remove('hidden');
        if (savedHouseNo) document.getElementById('custIdHouseNo').value = savedHouseNo;
        if (savedSoi) document.getElementById('custIdSoi').value = savedSoi;
    } else { document.getElementById('customerTableDisplay').innerText = savedName; }
}

document.getElementById('customerIdentityForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const name = document.getElementById('custIdName').value.trim(); const phone = document.getElementById('custIdPhone').value.trim(); const houseNo = document.getElementById('custIdHouseNo').value.trim(); const soi = document.getElementById('custIdSoi').value.trim();
    if(!name || !phone || !houseNo || !soi) { showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'warning'); return; }
    if(phone.length < 9 || isNaN(phone)) { showToast('เบอร์โทรศัพท์ไม่ถูกต้อง', 'warning'); return; }
    
    localStorage.setItem('customerName', name); localStorage.setItem('customerPhone', phone); localStorage.setItem('customerAddrHouse', houseNo); localStorage.setItem('customerAddrSoi', soi);
    document.getElementById('customerIdentityModal').classList.add('hidden'); document.getElementById('customerTableDisplay').innerText = name; showToast(`ยินดีต้อนรับคุณ ${name}`, 'success'); speak("ยินดีต้อนรับค่ะ");
});

function confirmLogout() { localStorage.removeItem('isLoggedIn'); localStorage.removeItem('userPhone'); location.reload(); }

function submitChangePassword() {
    const phoneVal = document.getElementById('changePassPhone').value.trim(); const newPass = document.getElementById('newPasswordInput').value.trim();
    if (!phoneVal) { alert("กรุณาระบุเบอร์โทรศัพท์"); return; } if (!newPass) { alert("กรุณากรอกรหัสผ่านใหม่"); return; }
    setLoading('btnSubmitChangePass', true, 'กำลังบันทึก...');
    
    setTimeout(() => {
        showToast('เปลี่ยนรหัสผ่านเรียบร้อย', 'success'); closeModal('changePassModal'); localStorage.setItem('userPhone', phoneVal);
        setLoading('btnSubmitChangePass', false, 'บันทึกรหัสผ่านใหม่');
    }, 500);
}

function makeDraggable(draggableElement, dragHandle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    if (dragHandle) { dragHandle.onmousedown = dragMouseDown; dragHandle.ontouchstart = dragMouseDown; } else { draggableElement.onmousedown = dragMouseDown; draggableElement.ontouchstart = dragMouseDown; }
    function dragMouseDown(e) { e = e || window.event; e.preventDefault(); let clientX = e.clientX; let clientY = e.clientY; if (e.touches && e.touches.length) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; } pos3 = clientX; pos4 = clientY; document.onmouseup = closeDragElement; document.onmousemove = elementDrag; document.ontouchend = closeDragElement; document.ontouchmove = elementDrag; }
    function elementDrag(e) { e = e || window.event; e.preventDefault(); let clientX = e.clientX; let clientY = e.clientY; if (e.touches && e.touches.length) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; } pos1 = pos3 - clientX; pos2 = pos4 - clientY; pos3 = clientX; pos4 = clientY; draggableElement.style.top = (draggableElement.offsetTop - pos2) + "px"; draggableElement.style.left = (draggableElement.offsetLeft - pos1) + "px"; }
    function closeDragElement() { document.onmouseup = null; document.onmousemove = null; document.ontouchend = null; document.ontouchmove = null; }
}

function togglePaymentMenu() { const menu = document.getElementById('paymentSettingsMenu'); if (menu) { if (menu.classList.contains('hidden')) { menu.classList.remove('hidden'); } else { menu.classList.add('hidden'); } } }

function numpadPress(num, btnElement) {
    if (btnElement) { btnElement.classList.remove('active:scale-95'); btnElement.classList.add('btn-pop'); setTimeout(() => { btnElement.classList.remove('btn-pop'); btnElement.classList.add('active:scale-95'); }, 150); }
    const paymentModal = document.getElementById('paymentModal'); const isPaymentOpen = !paymentModal.classList.contains('hidden');
    let targetInput;
    if (isPaymentOpen) { targetInput = document.getElementById('inputReceived'); } else { targetInput = document.getElementById('searchInput'); targetInput.focus(); }
    if (targetInput) { targetInput.value += num; targetInput.dispatchEvent(new Event('input', { bubbles: true })); }
}

function numpadAction(action) {
    const paymentModal = document.getElementById('paymentModal'); const isPaymentOpen = !paymentModal.classList.contains('hidden');
    let targetInput = isPaymentOpen ? document.getElementById('inputReceived') : document.getElementById('searchInput');
    if (action === 'del') { targetInput.value = targetInput.value.slice(0, -1); targetInput.dispatchEvent(new Event('input', { bubbles: true })); targetInput.focus(); } 
    else if (action === 'enter') { if (isPaymentOpen) { confirmPayment(); } else { processSearchEnter(); } }
}

function toggleSystemKeyboard() {
    const input = document.getElementById('searchInput'); const btn = document.getElementById('btnToggleKey');
    if (input.getAttribute('inputmode') === 'none') { input.setAttribute('inputmode', 'text'); btn.classList.add('bg-blue-500', 'text-white', 'border-blue-500'); btn.classList.remove('bg-white', 'text-gray-400', 'border-gray-200'); input.placeholder = "พิมพ์ชื่อสินค้า..."; input.focus(); } else { input.setAttribute('inputmode', 'none'); btn.classList.remove('bg-blue-500', 'text-white', 'border-blue-500'); btn.classList.add('bg-white', 'text-gray-400', 'border-gray-200'); input.placeholder = "ยิงบาร์โค้ด..."; input.blur(); }
}

let isEmbeddedNumpadOpen = false;
function toggleEmbeddedNumpad() {
    const panel = document.getElementById('embeddedNumpadPanel'); const keys = document.getElementById('embeddedKeys'); const miniBar = document.getElementById('minimizedBar');
    isEmbeddedNumpadOpen = !isEmbeddedNumpadOpen;
    if (isEmbeddedNumpadOpen) { keys.classList.remove('hidden'); miniBar.classList.add('hidden'); } else { keys.classList.add('hidden'); miniBar.classList.remove('hidden'); }
}

// ==========================================
// 💾 BACKUP & RESTORE DATA
// ==========================================
function dbClear(store) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const req = tx.objectStore(store).clear();
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

async function backupData() {
    setLoading('btnBackup', true, 'กำลังบันทึก...');
    try {
        const menu = await dbGetAll('menu');
        const history = await dbGetAll('history');
        const settings = await dbGetAll('settings');

        const backupObj = {
            timestamp: new Date().toISOString(),
            menu: menu,
            history: history,
            settings: settings
        };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupObj));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "pos_backup_" + new Date().toISOString().split('T')[0] + ".json");
        document.body.appendChild(downloadAnchorNode); 
        downloadAnchorNode.click();
        downloadAnchorNode.remove();

        showToast('ดาวน์โหลดไฟล์สำรองข้อมูลเรียบร้อย', 'success');
        closeModal('exportModal'); 

    } catch(e) {
        showCustomAlert('Error', 'ไม่สามารถสำรองข้อมูลได้: ' + e);
    } finally {
        setLoading('btnBackup', false, 'สร้างไฟล์ Backup');
    }
}

async function restoreData(event) {
    const file = event.target.files[0];
    if (!file) return;

    if(!confirm("⚠️ คำเตือนสำคัญ:\nการกู้คืนข้อมูลจะ 'ลบข้อมูลเดิมในเครื่องนี้' และแทนที่ด้วยข้อมูลจากไฟล์ Backup ใหม่ทั้งหมด!\n\nคุณต้องการดำเนินการต่อหรือไม่?")) {
        event.target.value = '';
        return;
    }

    setLoading('btnRestore', true, 'กำลังกู้คืน...');
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            if(data.menu) {
                await dbClear('menu');
                for(let item of data.menu) await dbPut('menu', item);
            }
            if(data.history) {
                await dbClear('history');
                for(let item of data.history) await dbPut('history', item);
            }
            if(data.settings) {
                await dbClear('settings');
                for(let item of data.settings) await dbPut('settings', item);
            }

            event.target.value = '';
            showToast('กู้คืนข้อมูลสำเร็จ! ระบบกำลังรีเฟรช...', 'success');
            setTimeout(() => location.reload(), 2000);
        } catch(err) {
            setLoading('btnRestore', false, 'กู้คืน (ย้ายเครื่อง)');
            showCustomAlert('Error', 'ไฟล์ Backup ไม่ถูกต้อง หรือเกิดข้อผิดพลาดในการอ่านไฟล์');
        }
    };
    reader.readAsText(file);
}

// ==========================================
// 📄 EXPORT PDF
// ==========================================
function openExportModal() {
    const today = new Date().toISOString().split('T')[0]; 
    document.getElementById('exportStartDate').value = today; 
    document.getElementById('exportEndDate').value = today; 
    document.getElementById('exportModal').classList.remove('hidden');
}

async function executeExportPDF() {
    const type = document.getElementById('exportType').value; 
    const start = document.getElementById('exportStartDate').value; 
    const end = document.getElementById('exportEndDate').value;
    
    if (!start || !end) { showToast('กรุณาเลือกวันที่ให้ครบ', 'warning'); return; }
    setLoading('btnDoExport', true, 'สร้างรายงาน...');
    
    try {
        const allHistory = await dbGetAll('history');
        const filtered = allHistory.filter(b => { 
            const bDate = b.date.split('T')[0]; 
            return bDate >= start && bDate <= end; 
        });

        let title = type === 'MonthlySales' ? 'รายงานสรุปยอดขายรายเดือน' : 
                    type === 'DailySales' ? 'รายงานสรุปยอดขายรายวัน' : 'รายงานรายละเอียดบิลขาย';

        let htmlContent = `
        <html>
        <head>
            <title>${title}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;600&display=swap');
                body { font-family: 'Sarabun', sans-serif; padding: 40px; color: #333; line-height: 1.5; } 
                .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 15px; }
                .header h1 { margin: 0 0 5px 0; color: #000; font-size: 26px;}
                .header p { margin: 0; color: #555; font-size: 14px;}
                table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; } 
                th, td { border: 1px solid #cbd5e1; padding: 10px; text-align: left; } 
                th { background-color: #f8fafc; color: #000; font-weight: bold; text-align: center;}
                .text-right { text-align: right; }
                .text-center { text-align: center; }
                .total-row { font-weight: bold; background-color: #f1f5f9; }
                .summary-box { border: 1px solid #000; padding: 15px; border-radius: 4px; margin-bottom: 20px; text-align: center; background-color: #f8fafc;}
                .signature-section { margin-top: 60px; display: flex; justify-content: space-between; text-align: center;}
                .sig-box { width: 45%; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>${title}</h1>
                <p>ข้อมูลตั้งแต่วันที่ <strong>${start}</strong> ถึง <strong>${end}</strong></p>
                <p>พิมพ์เอกสารเมื่อ: ${new Date().toLocaleString('th-TH')}</p>
            </div>`;

        if (type === 'DailySales' || type === 'MonthlySales') {
             let totalAmount = 0; 
             let totalBills = filtered.length;
             filtered.forEach(b => totalAmount += parseFloat(b.total));
             
             htmlContent += `
             <div class="summary-box">
                <p style="margin:0; font-size: 16px;">ยอดรวมการขายทั้งสิ้นในช่วงเวลาที่กำหนด</p>
                <h2 style="margin:5px 0 0 0; font-size: 28px;">${totalAmount.toLocaleString('th-TH', {minimumFractionDigits: 2})} บาท</h2>
                <p style="margin:5px 0 0 0; font-size: 14px; color: #666;">จากจำนวนการขาย ${totalBills} รายการ</p>
             </div>
             `;

             htmlContent += `<table><tr><th>วันที่</th><th>จำนวนบิล</th><th>ยอดขายรวม (บาท)</th></tr>`;
             
             const breakdown = {};
             const billCount = {};
             
             filtered.forEach(b => { 
                 const d = b.date.split('T')[0]; 
                 let groupKey = d;
                 if (type === 'MonthlySales') {
                     groupKey = d.substring(0, 7); 
                 }
                 breakdown[groupKey] = (breakdown[groupKey] || 0) + parseFloat(b.total); 
                 billCount[groupKey] = (billCount[groupKey] || 0) + 1;
             });

             const sortedKeys = Object.keys(breakdown).sort();

             sortedKeys.forEach(d => { 
                 htmlContent += `<tr>
                    <td class="text-center">${d}</td>
                    <td class="text-center">${billCount[d].toLocaleString()}</td>
                    <td class="text-right">${breakdown[d].toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
                 </tr>`; 
             });
             
             htmlContent += `
                <tr class="total-row">
                    <td class="text-center">รวมทั้งหมด</td>
                    <td class="text-center">${totalBills.toLocaleString()}</td>
                    <td class="text-right">${totalAmount.toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
                </tr>
             </table>`;
             
        } else if (type === 'Bill') {
             let totalAmount = 0;
             htmlContent += `<table><tr><th style="width:15%">รหัสอ้างอิงบิล</th><th style="width:15%">วัน/เวลา</th><th>รายการสินค้า</th><th style="width:15%">ยอดรวม (บาท)</th></tr>`;
             
             const sortedFiltered = filtered.sort((a,b) => new Date(a.date) - new Date(b.date));

             sortedFiltered.forEach(b => { 
                 totalAmount += parseFloat(b.total);
                 htmlContent += `<tr>
                    <td class="text-center">${b.billId}</td>
                    <td class="text-center">${new Date(b.date).toLocaleString('th-TH')}</td>
                    <td>${b.itemSummary}</td>
                    <td class="text-right">${parseFloat(b.total).toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
                 </tr>`; 
             });
             htmlContent += `<tr class="total-row"><td colspan="3" class="text-right">ยอดรวมทั้งหมด</td><td class="text-right">${totalAmount.toLocaleString('th-TH', {minimumFractionDigits: 2})}</td></tr>`;
             htmlContent += `</table>`;
        }

        htmlContent += `
            <div class="signature-section">
                <div class="sig-box">
                    <p>ผู้จัดทำรายงาน</p>
                    <br><br>
                    <p>.......................................................</p>
                    <p>(.......................................................)</p>
                    <p>วันที่ ......../......../..............</p>
                </div>
                <div class="sig-box">
                    <p>ผู้ตรวจสอบ / รับรองความถูกต้อง</p>
                    <br><br>
                    <p>.......................................................</p>
                    <p>(.......................................................)</p>
                    <p>วันที่ ......../......../..............</p>
                </div>
            </div>
        </body></html>`;
        
        const printWindow = window.open('', '_blank');
        printWindow.document.write(htmlContent);
        printWindow.document.close();

        showToast('สร้างรายงานเรียบร้อย', 'success'); 
        closeModal('exportModal');
    } catch (err) {
        showCustomAlert('ผิดพลาด', 'สร้างรายงานไม่สำเร็จ: ' + err);
    } finally {
        setLoading('btnDoExport', false, 'พิมพ์รายงาน PDF');
    }
}

function syncSearch(val) {
    const mainInput = document.getElementById('searchInput'); mainInput.value = val; searchMenu();
    const btnClear = document.getElementById('btnClearFloat'); if(val) { btnClear.classList.remove('hidden'); } else { btnClear.classList.add('hidden'); }
}

function clearFloatingSearch() { const floatInput = document.getElementById('floatingSearchInput'); floatInput.value = ''; syncSearch(''); floatInput.focus(); }

document.addEventListener('click', function(event) {
    const menu = document.getElementById('paymentSettingsMenu'); const btnMenu = document.querySelector('button[onclick="togglePaymentMenu()"]');
    if (menu && !menu.classList.contains('hidden')) { if (!menu.contains(event.target) && btnMenu && !btnMenu.contains(event.target)) { menu.classList.add('hidden'); } }
    if (typeof isCustomerMode !== 'undefined' && isCustomerMode) return;
    const targetTag = event.target.tagName ? event.target.tagName.toLowerCase() : '';
    const isInput = targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select';
    const ignoreModals = ['paymentModal', 'addModal', 'editMenuModal', 'promptPayModal', 'confirmOrderModal', 'changePassModal', 'productModal'];
    const isAnyInputModalOpen = ignoreModals.some(modalId => { const modal = document.getElementById(modalId); return modal && !modal.classList.contains('hidden'); });
    const isNumpadClick = event.target.closest('#embeddedNumpadPanel') !== null;
    const isFloatingSearchClick = event.target.closest('#floatingSearchContainer') !== null; 

    if (!isInput && !isAnyInputModalOpen && !isNumpadClick && !isFloatingSearchClick) {
        setTimeout(() => { const searchInput = document.getElementById('searchInput'); if (searchInput) { searchInput.focus(); searchInput.value = ''; } }, 100);
    }
});

// ==========================================
// 🚀 INITIALIZATION 
// ==========================================
window.onload = async () => {
    await initDB();

    checkMode();                 
    checkLoginStatus();          
    initStoreStatus();           
    
    initDateTime();              
    fetchMenu();                 
    renderCategoryBar();         
    populateCategorySelects();   
    
    startOrderPolling();         
    initGlobalShortcuts();       
    initQuickAddShortcuts();     
    
    const modal = document.getElementById("draggableModal");
    const header = document.getElementById("modalHeader");
    if (modal && header) { makeDraggable(modal, header); }

    setTimeout(() => {
        const searchInput = document.getElementById('searchInput');
        if (searchInput && typeof isCustomerMode !== 'undefined' && !isCustomerMode) {
            searchInput.focus();
            searchInput.value = '';
        }
    }, 500); 
};

// ==========================================
// 📥 IMPORT DATA FROM CSV
// ==========================================
function handleImportCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    showToast('กำลังนำเข้าข้อมูล... กรุณารอสักครู่', 'warning');

    const reader = new FileReader();
    reader.onload = async function(e) {
        const text = e.target.result;
        const rows = text.split(/\r?\n/);
        let successCount = 0;
        let updateCount = 0;
        
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i].trim();
            if (!row) continue; 
            
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            
            if (cols.length >= 3) {
                const id = cols[0].replace(/^"|"$/g, '').trim();
                const name = cols[1].replace(/^"|"$/g, '').trim();
                const price = parseFloat(cols[2].replace(/^"|"$/g, '').trim());
                const cost = cols[3] ? parseFloat(cols[3].replace(/^"|"$/g, '').trim()) : 0;
                
                if (id && name && !isNaN(price)) {
                    const newItem = {
                        id: id,
                        name: name,
                        price: price,
                        cost: isNaN(cost) ? 0 : cost, 
                        category: "เบ็ดเตล็ด", 
                        image: "",
                        isHidden: false
                    };
                    
                    try {
                        const existingItem = await dbGet('menu', id);
                        await dbPut('menu', newItem);
                        
                        if (existingItem) {
                            updateCount++;
                        } else {
                            successCount++;
                        }
                    } catch(err) {
                        console.error("เกิดข้อผิดพลาดที่บรรทัด " + i, err);
                    }
                }
            }
        }
        
        event.target.value = ''; 
        closeModal('exportModal');
        showToast(`เพิ่มใหม่ ${successCount} รายการ, อัปเดต ${updateCount} รายการ`, 'success');
        fetchMenu(); 
    };
    
    reader.readAsText(file, 'UTF-8'); 
}

// ==========================================
// 📥 IMPORT HISTORY FROM CSV 
// ==========================================
function importHistoryCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    showToast('กำลังประมวลผลบิล... อาจใช้เวลาสักครู่', 'warning');

    const reader = new FileReader();
    reader.onload = async function(e) {
        const text = e.target.result;
        const rows = text.split(/\r?\n/);
        let successCount = 0;

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i].trim();
            if (!row) continue;

            const cols = [];
            let inQuote = false;
            let currentVal = '';
            for (let char of row) {
                if (char === '"') {
                    inQuote = !inQuote;
                } else if (char === ',' && !inQuote) {
                    cols.push(currentVal);
                    currentVal = '';
                } else {
                    currentVal += char;
                }
            }
            cols.push(currentVal);

            if (cols.length >= 4) {
                const dateStr = cols[0].replace(/^"|"$/g, '').trim(); 
                const summaryStr = cols[1].replace(/^"|"$/g, '').trim();
                const qtyStr = cols[2].replace(/^"|"$/g, '').trim();
                const totalStr = cols[3].replace(/^"|"$/g, '').trim();
                const recvStr = cols[4] ? cols[4].replace(/^"|"$/g, '').trim() : totalStr;
                const changeStr = cols[5] ? cols[5].replace(/^"|"$/g, '').trim() : '0';

                let isoDate = new Date().toISOString();
                try {
                    const parts = dateStr.split(', ');
                    if (parts.length === 2) {
                        const dmy = parts[0].split('/'); 
                        const hms = parts[1].split(':'); 
                        const parsedDate = new Date(dmy[2], dmy[1] - 1, dmy[0], hms[0], hms[1], hms[2]);
                        if (!isNaN(parsedDate.getTime())) {
                            isoDate = parsedDate.toISOString();
                        }
                    }
                } catch(err) {}

                const totalAmount = parseFloat(totalStr.replace(/[^0-9.-]+/g, "")) || 0;
                const receiveAmount = parseFloat(recvStr.replace(/[^0-9.-]+/g, "")) || totalAmount;
                const changeAmount = parseFloat(changeStr.replace(/[^0-9.-]+/g, "")) || 0;
                const totalQty = parseInt(qtyStr.replace(/[^0-9.-]+/g, "")) || 1;

                const newBill = {
                    billId: "CSV-" + Date.now() + "-" + i,
                    date: isoDate,
                    table: "นำเข้าจากระบบเก่า",
                    type: "นำเข้าข้อมูล",
                    itemSummary: summaryStr,
                    items: [{ name: "สินค้าจากระบบเก่า", qty: totalQty, price: totalAmount / totalQty }],
                    total: totalAmount,
                    receive: receiveAmount,
                    change: changeAmount,
                    note: "Imported from CSV"
                };

                try {
                    await dbPut('history', newBill);
                    successCount++;
                } catch(err) {
                    console.error("Row import error: ", err);
                }
            }
        }
        
        event.target.value = ''; 
        closeModal('exportModal');
        showToast(`นำเข้าสำเร็จ ${successCount} รายการ!`, 'success');
        
        setTimeout(() => {
            openSalesModal();
        }, 1000);
    };
    
    reader.readAsText(file, 'UTF-8');
}

let mySalesChart = null; 
let mySales7DaysChart = null; 
let myTop3PieChart = null;
let myTop5PieChart = null;

async function openDashboardModal() {
    closeModal('exportModal');
    document.getElementById('dashboardModal').classList.remove('hidden');
    document.getElementById('dashLoading').classList.remove('hidden');
    document.getElementById('dashContent').classList.add('hidden');

    try {
        const history = await dbGetAll('history');
        
        const profitInput = document.getElementById('dashProfitInput');
        const profitMarginVal = profitInput ? parseFloat(profitInput.value) || 12.5 : 12.5;
        const profitPercent = profitMarginVal / 100;
        
        const label1 = document.getElementById('dashProfitLabel1');
        const label2 = document.getElementById('dashProfitLabel2');
        if(label1) label1.innerText = profitMarginVal;
        if(label2) label2.innerText = profitMarginVal;

        const tzOffset = (new Date()).getTimezoneOffset() * 60000;
        const now = new Date(Date.now() - tzOffset);
        const todayStr = now.toISOString().split('T')[0];
        const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); 
        const thisMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
        
        let lastMonth = currentMonth - 1;
        let lastMonthYear = currentYear;
        if (lastMonth < 0) { lastMonth = 11; lastMonthYear--; }
        const lastMonthStr = `${lastMonthYear}-${String(lastMonth + 1).padStart(2, '0')}`;
        
        const monthNames = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
        
        document.getElementById('lastMonthNameLabel').innerText = monthNames[lastMonth];
        document.getElementById('thisMonthNameLabel').innerText = monthNames[currentMonth];

        let todaySales = 0, yesterdaySales = 0, todayBills = 0, lastMonthSales = 0;
        let itemCountsThisMonth = {}; 
        let itemCountsLastMonth = {};
        let peakCountsAllTime = {}; 
        let peakCountsLastMonth = {};

        const last7DaysData = [];
        const last7DaysLabels = [];
        for(let i=6; i>=0; i--) {
            const d = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
            const dStr = d.toISOString().split('T')[0];
            last7DaysLabels.push(d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }));
            last7DaysData.push({ dateStr: dStr, sales: 0, profit: 0 });
        }

        const monthlySalesData = new Array(currentMonth + 1).fill(0);
        const monthlyProfitData = new Array(currentMonth + 1).fill(0);

        history.forEach(bill => {
            const billDateLocal = new Date(bill.date);
            const bDateStr = `${billDateLocal.getFullYear()}-${String(billDateLocal.getMonth() + 1).padStart(2, '0')}-${String(billDateLocal.getDate()).padStart(2, '0')}`;
            const bYear = billDateLocal.getFullYear();
            const bMonth = billDateLocal.getMonth();
            const yyyymm = `${bYear}-${String(bMonth + 1).padStart(2, '0')}`;
            
            const dayOfWeek = billDateLocal.getDay(); 
            const hour = billDateLocal.getHours(); 
            const dayHourKey = `${dayOfWeek}_${hour}`; 
            
            const total = parseFloat(bill.total || 0);

            let items = [];
            try { items = typeof bill.items === 'string' ? JSON.parse(bill.items) : bill.items; } catch(e){}

            if (bDateStr === todayStr) { todaySales += total; todayBills++; } 
            else if (bDateStr === yesterdayStr) { yesterdaySales += total; }

            const targetDay = last7DaysData.find(d => d.dateStr === bDateStr);
            if(targetDay) {
                targetDay.sales += total;
                targetDay.profit += (total * profitPercent);
            }

            if (bYear === currentYear && bMonth <= currentMonth) {
                monthlySalesData[bMonth] += total;
                monthlyProfitData[bMonth] += (total * profitPercent); 
            }

            peakCountsAllTime[dayHourKey] = (peakCountsAllTime[dayHourKey] || 0) + 1;

            if (yyyymm === lastMonthStr) {
                lastMonthSales += total;
                peakCountsLastMonth[dayHourKey] = (peakCountsLastMonth[dayHourKey] || 0) + 1;
                items.forEach(i => {
                    let itemName = i.name;
                    if (itemName === "สินค้าจากระบบเก่า" && bill.itemSummary) itemName = bill.itemSummary;
                    if (itemName === "สินค้าทั่วไป") return;
                    const qty = parseInt(i.qty || 1);
                    if (!itemCountsLastMonth[itemName]) itemCountsLastMonth[itemName] = 0;
                    itemCountsLastMonth[itemName] += qty;
                });
            }

            if (yyyymm === thisMonthStr) {
                items.forEach(i => {
                    let itemName = i.name;
                    if (itemName === "สินค้าจากระบบเก่า" && bill.itemSummary) itemName = bill.itemSummary;
                    if (itemName === "สินค้าทั่วไป") return;
                    const qty = parseInt(i.qty || 1);
                    const revenue = parseFloat(i.price || 0) * qty;
                    if (!itemCountsThisMonth[itemName]) itemCountsThisMonth[itemName] = { qty: 0, rev: 0 };
                    itemCountsThisMonth[itemName].qty += qty;
                    itemCountsThisMonth[itemName].rev += revenue;
                });
            }
        });

        const todayProfit = todaySales * profitPercent;
        document.getElementById('dashTodaySales').innerHTML = `${todaySales.toLocaleString()} <span class="text-lg">฿</span>`;
        document.getElementById('dashTodayProfit').innerHTML = `${todayProfit.toLocaleString()} <span class="text-lg">฿</span>`;
        document.getElementById('dashTodayBills').innerText = todayBills.toLocaleString();

        const growthEl = document.getElementById('dashGrowth');
        if (yesterdaySales === 0 && todaySales > 0) {
            growthEl.innerHTML = `<span class="text-green-500"><i class="fas fa-arrow-up"></i> +100%</span> (เมื่อวานไม่มียอด)`;
        } else if (yesterdaySales === 0 && todaySales === 0) {
            growthEl.innerHTML = `<span class="text-gray-400"><i class="fas fa-minus"></i> 0%</span> (เทียบเมื่อวาน)`;
        } else {
            const percent = ((todaySales - yesterdaySales) / yesterdaySales) * 100;
            if (percent > 0) {
                growthEl.innerHTML = `<span class="text-green-500"><i class="fas fa-arrow-up"></i> +${percent.toFixed(1)}%</span> (เทียบเมื่อวาน)`;
            } else if (percent < 0) {
                growthEl.innerHTML = `<span class="text-red-500"><i class="fas fa-arrow-down"></i> ${Math.abs(percent).toFixed(1)}%</span> (เทียบเมื่อวาน)`;
            } else {
                growthEl.innerHTML = `<span class="text-gray-400"><i class="fas fa-minus"></i> 0%</span> (เทียบเมื่อวาน)`;
            }
        }

        const lastMonthProfit = lastMonthSales * profitPercent;
        document.getElementById('dashLastMonthSales').innerHTML = `${lastMonthSales.toLocaleString()} <span class="text-lg">฿</span>`;
        document.getElementById('dashLastMonthProfit').innerHTML = `${lastMonthProfit.toLocaleString()} <span class="text-lg">฿</span>`;

        // ---------------------------------------------------------
        // กราฟ 1: แท่ง/เส้น ยอดขายและกำไร 7 วัน + เส้นค่าเฉลี่ย
        // ---------------------------------------------------------
        const ctx7 = document.getElementById('sales7DaysChart');
        if(ctx7) {
            if (mySales7DaysChart) mySales7DaysChart.destroy();
            
            // คำนวณค่าเฉลี่ย 7 วัน
            const total7DaysSales = last7DaysData.reduce((sum, d) => sum + d.sales, 0);
            const avg7DaysSales = total7DaysSales / 7;
            const avg7DaysEl = document.getElementById('avg7Days');
            if (avg7DaysEl) avg7DaysEl.innerText = `เฉลี่ย: ${avg7DaysSales.toLocaleString('th-TH', {maximumFractionDigits: 0})} ฿/วัน`;

            mySales7DaysChart = new Chart(ctx7.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: last7DaysLabels,
                    datasets: [
                        {
                            label: 'ยอดขายเฉลี่ย (บาท)',
                            data: Array(7).fill(avg7DaysSales),
                            type: 'line',
                            borderColor: 'rgba(239, 68, 68, 0.6)', // สีแดงอ่อนๆ
                            borderWidth: 2,
                            borderDash: [5, 5],
                            pointRadius: 0,
                            order: 0
                        },
                        {
                            label: 'ยอดขาย (บาท)',
                            data: last7DaysData.map(d => d.sales),
                            backgroundColor: 'rgba(59, 130, 246, 0.8)',
                            borderRadius: 4,
                            order: 2
                        },
                        {
                            label: `กำไรประเมิน ${profitMarginVal}% (บาท)`,
                            data: last7DaysData.map(d => d.profit),
                            backgroundColor: 'rgba(34, 197, 94, 0.9)',
                            type: 'line',
                            borderColor: 'rgba(34, 197, 94, 1)',
                            borderWidth: 2,
                            tension: 0.3,
                            pointBackgroundColor: 'white',
                            order: 1
                        }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { labels: { font: { family: 'Kanit' } } } },
                    scales: { y: { beginAtZero: true } }
                }
            });
        }

        // ---------------------------------------------------------
        // กราฟ 2: แท่ง/เส้น รายเดือน (ม.ค.) + เส้นค่าเฉลี่ย
        // ---------------------------------------------------------
        const ctxSales = document.getElementById('salesChart');
        if (ctxSales) {
            if (mySalesChart) mySalesChart.destroy();
            const chartLabels = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'].slice(0, currentMonth + 1);
            
            // คำนวณค่าเฉลี่ยรายเดือน
            const monthsCount = currentMonth + 1;
            const totalMonthlySales = monthlySalesData.reduce((sum, val) => sum + val, 0);
            const avgMonthlySales = totalMonthlySales / monthsCount;
            const avgMonthlyEl = document.getElementById('avgMonthly');
            if (avgMonthlyEl) avgMonthlyEl.innerText = `เฉลี่ย: ${avgMonthlySales.toLocaleString('th-TH', {maximumFractionDigits: 0})} ฿/เดือน`;

            mySalesChart = new Chart(ctxSales.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: chartLabels,
                    datasets: [
                        {
                            label: 'ยอดขายเฉลี่ย (บาท)',
                            data: Array(monthsCount).fill(avgMonthlySales),
                            type: 'line',
                            borderColor: 'rgba(239, 68, 68, 0.6)', // สีแดงอ่อนๆ
                            borderWidth: 2,
                            borderDash: [5, 5],
                            pointRadius: 0,
                            order: 0
                        },
                        {
                            label: 'ยอดขายรวม (บาท)',
                            data: monthlySalesData,
                            backgroundColor: 'rgba(59, 130, 246, 0.8)',
                            borderRadius: 4,
                            order: 2
                        },
                        {
                            label: `กำไรประเมิน ${profitMarginVal}% (บาท)`,
                            data: monthlyProfitData,
                            backgroundColor: 'rgba(34, 197, 94, 0.9)',
                            type: 'line',
                            borderColor: 'rgba(34, 197, 94, 1)',
                            borderWidth: 2,
                            tension: 0.3,
                            pointBackgroundColor: 'white',
                            order: 1
                        }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'top', labels: { font: { family: 'Kanit' } } },
                        tooltip: { callbacks: { label: function(context) { return context.dataset.label + ': ' + context.parsed.y.toLocaleString() + ' ฿'; } } }
                    },
                    scales: { y: { beginAtZero: true, ticks: { callback: function(value) { return value.toLocaleString(); } } } }
                }
            });
        }

        // ---------------------------------------------------------
        // กราฟ 3: พาย (กลม) Top 3 สินค้าขายดี (เดือนที่แล้ว)
        // ---------------------------------------------------------
        const sortedLastMonthItems = Object.entries(itemCountsLastMonth).sort((a, b) => b[1] - a[1]).slice(0, 3);
        const ctxTop3 = document.getElementById('top3PieChart');
        if (ctxTop3 && sortedLastMonthItems.length > 0) {
            if (myTop3PieChart) myTop3PieChart.destroy();
            myTop3PieChart = new Chart(ctxTop3.getContext('2d'), {
                type: 'pie',
                data: {
                    labels: sortedLastMonthItems.map(item => item[0]),
                    datasets: [{
                        data: sortedLastMonthItems.map(item => item[1]),
                        backgroundColor: ['#3b82f6', '#f59e0b', '#10b981']
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { family: 'Kanit', size: 10 } } } } }
            });
        } else if(document.getElementById('dashLastMonthTopItems_container')) {
            document.getElementById('dashLastMonthTopItems_container').innerHTML = '<span class="text-xs text-indigo-400 bg-indigo-50 px-3 py-1 rounded">ไม่มีข้อมูลสินค้า</span>';
        }

        // ---------------------------------------------------------
        // กราฟ 4: โดนัท Top 5 สินค้าทำเงิน (เดือนนี้)
        // ---------------------------------------------------------
        const topItemsThisMonth = Object.entries(itemCountsThisMonth).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.rev - a.rev).slice(0, 5);
        const ctxTop5 = document.getElementById('top5PieChart');
        if (ctxTop5 && topItemsThisMonth.length > 0) {
            if (myTop5PieChart) myTop5PieChart.destroy();
            myTop5PieChart = new Chart(ctxTop5.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: topItemsThisMonth.map(item => item.name),
                    datasets: [{
                        data: topItemsThisMonth.map(item => item.rev),
                        backgroundColor: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6']
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { family: 'Kanit' } } }, tooltip: { callbacks: { label: function(context) { return context.label + ': ' + context.parsed.toLocaleString() + ' ฿'; } } } } }
            });
        } else if(document.getElementById('dashTopItems_container')) {
            document.getElementById('dashTopItems_container').innerHTML = '<p class="text-center text-gray-400 py-4 text-sm">ยังไม่มีข้อมูลการขายในเดือนนี้</p>';
        }

        // ---------------------------------------------------------
        // Peak Hours 
        // ---------------------------------------------------------
        const daysFull = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
        const peakContainer = document.getElementById('dashPeakHours');
        const sortedAllTimePeak = Object.entries(peakCountsAllTime).sort((a, b) => b[1] - a[1]).slice(0, 3);
        
        if (sortedAllTimePeak.length > 0) {
            peakContainer.innerHTML = sortedAllTimePeak.map(([key, count], idx) => {
                const [d, h] = key.split('_');
                let timeText = `วัน${daysFull[d]} ${String(h).padStart(2, '0')}:00 - ${String(parseInt(h)+1).padStart(2, '0')}:00`;
                let rankColor = idx === 0 ? 'bg-red-500' : (idx === 1 ? 'bg-orange-500' : 'bg-blue-500');
                return `<div class="flex justify-between items-center bg-gray-50 border border-gray-100 p-2.5 rounded-xl"><div class="font-bold text-gray-700 text-sm flex items-center gap-2"><span class="${rankColor} text-white w-6 h-6 rounded-full flex shrink-0 items-center justify-center text-xs shadow-sm">${idx + 1}</span><span class="truncate">${timeText}</span></div><div class="bg-white px-3 py-1 rounded shadow-sm text-xs font-bold text-blue-600 border border-blue-100 shrink-0">${count} บิล</div></div>`;
            }).join('');
        } else {
            peakContainer.innerHTML = '<p class="text-center text-gray-400 py-4 text-sm">ยังไม่มีบิลในระบบ</p>';
        }

        setTimeout(() => {
            document.getElementById('dashLoading').classList.add('hidden');
            document.getElementById('dashContent').classList.remove('hidden');
        }, 400);

    } catch (err) {
        console.error(err);
        document.getElementById('dashLoading').innerHTML = '<div class="text-red-500 text-center"><i class="fas fa-exclamation-triangle text-4xl mb-2"></i><p>โหลดข้อมูลผิดพลาด</p></div>';
    }
}

// ==========================================
// 📄 EXPORT DASHBOARD TO PDF
// ==========================================
function exportDashboardPDF() {
    const btn = document.getElementById('btnExportDash');
    const originalHTML = btn.innerHTML;
    
    // เปลี่ยนข้อความปุ่มระหว่างโหลด
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span class="hidden sm:inline">กำลังสร้าง...</span>';
    btn.disabled = true;
    showToast('กำลังเตรียมไฟล์ PDF กรุณารอสักครู่...', 'warning');

    // เลือกส่วนของหน้าจอที่ต้องการแคปเจอร์ (เฉพาะเนื้อหาแดชบอร์ด)
    const element = document.getElementById('dashContent');
    
    // สำรอง Style เดิมไว้
    const originalHeight = element.style.height;
    const originalOverflow = element.style.overflow;
    
    // ตั้งค่าเพื่อให้แคปเจอร์ได้เต็มหน้า (ไม่ถูกตัดจาก Scrollbar)
    element.style.height = 'auto';
    element.style.overflow = 'visible';

    // ตั้งค่าหน้ากระดาษ PDF
    const opt = {
        margin:       [10, 10, 10, 10], // ขอบกระดาษ (บน, ซ้าย, ล่าง, ขวา)
        filename:     `Dashboard_Report_${new Date().toISOString().split('T')[0]}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false }, // scale: 2 ช่วยให้ภาพชัดขึ้น
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    // สั่งสร้าง PDF
    html2pdf().set(opt).from(element).save().then(() => {
        // คืนค่าปุ่มและ Style กลับเป็นเหมือนเดิมหลังโหลดเสร็จ
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        element.style.height = originalHeight;

        element.style.overflow = originalOverflow;
        showToast('ดาวน์โหลด PDF สำเร็จ!', 'success');
    }).catch(err => {
        console.error(err);
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        element.style.height = originalHeight;
        element.style.overflow = originalOverflow;
        showCustomAlert('ผิดพลาด', 'ไม่สามารถสร้างไฟล์ PDF ได้');
    });
}


// ตั้งค่า Database (ต้องแก้ให้ตรงกับของคุณ)
const dbName = 'POS_DB'; 
const storeName = 'menu';

// --- ส่วนเปิด/ปิดหน้าต่างจัดการสินค้า ---
const modal = document.getElementById('productModal');
const openBtn = document.getElementById('openModalBtn');
const closeBtn = document.getElementById('closeModalBtn');

openBtn.addEventListener('click', () => {
    modal.style.display = 'block';
    loadProductsFromDB(); 
    
    // เคลียร์ข้อความค้นหาเดิมทิ้ง
    const searchInput = document.getElementById('modalSearchInput');
    if (searchInput) {
        searchInput.value = ''; 
        setTimeout(() => searchInput.focus(), 100); // ให้เคอร์เซอร์ไปรอที่ช่องค้นหา
    }
});

closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
    document.getElementById('searchInput').focus(); // คืนโฟกัสกลับไปช่องสแกนตอนปิด
});

window.addEventListener('click', (event) => {
    if (event.target == modal) {
        modal.style.display = 'none';
        document.getElementById('searchInput').focus();
    }
});

// ระบบคำนวณราคา
document.getElementById('costPrice').addEventListener('input', calculatePrice);
document.getElementById('profitPercent').addEventListener('input', calculatePrice);

function calculatePrice() {
    const cost = parseFloat(document.getElementById('costPrice').value) || 0;
    const percent = parseFloat(document.getElementById('profitPercent').value) || 0;
    const final = cost + (cost * (percent / 100));
    document.getElementById('suggestedPrice').textContent = final.toFixed(2);
}

// โหลดข้อมูลจาก IndexedDB มาใส่ตาราง
function loadProductsFromDB() {
    const request = indexedDB.open(dbName);
    
    request.onsuccess = function(event) {
        const db = event.target.result;
        
        // เช็คว่ามี Store นี้อยู่ในฐานข้อมูลหรือไม่
        if (!db.objectStoreNames.contains(storeName)) {
            console.error("ไม่พบ Store ชื่อ " + storeName);
            return;
        }

        const transaction = db.transaction([storeName], "readonly");
        const store = transaction.objectStore(storeName);
        const getAllRequest = store.getAll();

        getAllRequest.onsuccess = function() {
            renderTable(getAllRequest.result);
        };
    };
}

function renderTable(products) {
    const tbody = document.getElementById('productTableBody');
    tbody.innerHTML = ''; 
    
    if(products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">ยังไม่มีรายการสินค้า</td></tr>';
        return;
    }

    products.forEach(product => {
        // เช็คชื่อ property ของคุณด้วยนะครับ ว่าใช้ id, name, price ตามนี้หรือไม่
        // ถ้าของคุณตั้งชื่อว่า productId, productName ให้แก้ตัวแปรด้านล่างตามนั้นครับ
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${product.id}</td>
            <td contenteditable="true" class="editable" id="name-${product.id}">${product.name}</td>
            <td contenteditable="true" class="editable" id="price-${product.id}">${product.price}</td>
            <td><button onclick="saveProduct('${product.id}')">บันทึก</button></td>
        `;
        tbody.appendChild(tr);
    });
}

// อัปเดตข้อมูล
function saveProduct(productId) {
    const newName = document.getElementById(`name-${productId}`).innerText.trim();
    const newPrice = parseFloat(document.getElementById(`price-${productId}`).innerText);

    if (isNaN(newPrice)) {
        alert('กรุณากรอกราคาให้ถูกต้อง');
        return;
    }

    const request = indexedDB.open(dbName);
    request.onsuccess = function(event) {
        const db = event.target.result;
        const transaction = db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        
        const getRequest = store.get(productId);
        getRequest.onsuccess = function() {
            const data = getRequest.result;
            if (data) {
                data.name = newName;
                data.price = newPrice;
                const updateRequest = store.put(data);
                updateRequest.onsuccess = () => {
                    alert('บันทึกเรียบร้อย');
                };
            }
        };
    };
}

// --- ระบบค้นหาสินค้าในหน้าต่าง Modal (แบบลดอาการหน่วง / Debounce) ---
const modalSearchInput = document.getElementById('modalSearchInput');

// สร้างตัวแปรไว้เก็บตัวจับเวลา
let searchTimeout = null;

if (modalSearchInput) {
    modalSearchInput.addEventListener('input', function() {
        const filterText = this.value.toLowerCase().trim(); 
        const rows = document.querySelectorAll('#productTableBody tr'); 

        // 1. ถ้ายูสเซอร์กำลังพิมพ์อยู่ ให้ยกเลิกคำสั่งค้นหาเดิมไปก่อน
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }

        // 2. ตั้งเวลาใหม่ ถ้าหยุดพิมพ์เกิน 300 มิลลิวินาที (0.3 วินาที) ค่อยเริ่มค้นหา
        searchTimeout = setTimeout(() => {
            rows.forEach(row => {
                if (row.cells.length <= 1) return; 

                const idText = row.cells[0].innerText.toLowerCase();
                const nameText = row.cells[1].innerText.toLowerCase();
                
                if (idText.includes(filterText) || nameText.includes(filterText)) {
                    row.style.display = ''; 
                } else {
                    row.style.display = 'none'; 
                }
            });
        }, 300); // <--- ปรับตัวเลขตรงนี้ได้ (300 คือลื่นกำลังดี แต่ถ้าของเยอะมากอาจจะปรับเป็น 500)
    });
}

// ==========================================
// 📥 EXPORT PRODUCTS (CSV & PDF)
// ==========================================

// 1. ฟังก์ชันโหลดไฟล์ CSV (เปิดใน Excel ได้เลย รองรับภาษาไทย)
async function exportProductsCSV() {
    try {
        const products = await dbGetAll('menu'); // ดึงข้อมูลทั้งหมดจากฐานข้อมูล
        if(products.length === 0) {
            showToast('ไม่มีข้อมูลสินค้าเพื่อ Export', 'warning');
            return;
        }
        
        // ใส่ BOM (\uFEFF) เพื่อให้ Excel อ่านภาษาไทยได้โดยไม่เป็นภาษาต่างดาว
        let csvContent = "\uFEFF"; 
        csvContent += "รหัสสินค้า,ชื่อสินค้า,ราคา (บาท),หมวดหมู่\n";
        
        products.forEach(p => {
            const id = `"${(p.id || '').toString().replace(/"/g, '""')}"`;
            const name = `"${(p.name || '').toString().replace(/"/g, '""')}"`;
            const price = p.price || 0;
            const category = `"${(p.category || 'ทั่วไป').toString().replace(/"/g, '""')}"`;
            csvContent += `${id},${name},${price},${category}\n`;
        });
        
        // สร้างลิงก์ดาวน์โหลด
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Product_List_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showToast('ดาวน์โหลดไฟล์ CSV สำเร็จ!', 'success');
    } catch(e) {
        console.error("Export CSV Error:", e);
        showCustomAlert('ผิดพลาด', 'ไม่สามารถสร้างไฟล์ CSV ได้');
    }
}

// 2. ฟังก์ชันโหลดไฟล์ PDF (ตารางสรุปสินค้าสวยงาม - แก้ไขปัญหาหน้าว่าง)
async function exportProductsPDF() {
    try {
        const products = await dbGetAll('menu');
        if(products.length === 0) {
            showToast('ไม่มีข้อมูลสินค้าเพื่อ Export', 'warning');
            return;
        }
        
        showToast('กำลังเตรียมไฟล์ PDF กรุณารอสักครู่...', 'warning');

        // ใส่พื้นหลังสีขาว และกำหนดความกว้างให้ชัดเจน (ช่วยป้องกันหน้าว่าง)
        let html = `
        <div id="tempPdfContainer" style="font-family: 'Kanit', sans-serif; padding: 20px; color: #333; background-color: #ffffff; width: 800px;">
            <h2 style="text-align: center; margin-bottom: 5px; color: #1e3a8a;">รายการสินค้าทั้งหมด</h2>
            <p style="text-align: center; font-size: 12px; color: #666; margin-bottom: 20px;">ข้อมูล ณ วันที่: ${new Date().toLocaleDateString('th-TH')}</p>
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead>
                    <tr style="background-color: #f3f4f6; color: #1f2937;">
                        <th style="border: 1px solid #d1d5db; padding: 8px; text-align: left; width: 20%;">รหัสสินค้า</th>
                        <th style="border: 1px solid #d1d5db; padding: 8px; text-align: left; width: 40%;">ชื่อสินค้า</th>
                        <th style="border: 1px solid #d1d5db; padding: 8px; text-align: left; width: 20%;">หมวดหมู่</th>
                        <th style="border: 1px solid #d1d5db; padding: 8px; text-align: right; width: 20%;">ราคา (฿)</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        products.forEach(p => {
            html += `
            <tr>
                <td style="border: 1px solid #d1d5db; padding: 6px;">${p.id || '-'}</td>
                <td style="border: 1px solid #d1d5db; padding: 6px;">${p.name || '-'}</td>
                <td style="border: 1px solid #d1d5db; padding: 6px;">${p.category || 'ทั่วไป'}</td>
                <td style="border: 1px solid #d1d5db; padding: 6px; text-align: right; font-weight: bold;">${parseFloat(p.price || 0).toLocaleString()}</td>
            </tr>`;
        });
        
        html += `</tbody></table>
                 <p style="text-align: right; font-size: 10px; margin-top: 10px; color: #888;">จำนวนสินค้าทั้งหมด ${products.length} รายการ</p>
                 </div>`;
        
        // 🟢 ส่วนที่แก้ไข: นำ element ไปแปะในหน้าเว็บก่อน แต่ซ่อนไว้ไม่ให้ใครเห็น
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        wrapper.style.position = 'absolute';
        wrapper.style.left = '-9999px'; // ซ่อนไว้ทางซ้ายนอกจอ
        wrapper.style.top = '0';
        document.body.appendChild(wrapper); // แปะลงในเว็บ
        
        // กำหนดส่วนที่จะให้แปลงเป็น PDF
        const elementToPrint = wrapper.firstElementChild;
        
        // ตั้งค่าหน้ากระดาษ PDF
        const opt = {
            margin:       10,
            filename:     `Product_List_${new Date().toISOString().split('T')[0]}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        
        // สั่งพิมพ์ และเมื่อพิมพ์เสร็จให้ลบโค้ดที่ซ่อนไว้ออก
        html2pdf().set(opt).from(elementToPrint).save().then(() => {
            showToast('ดาวน์โหลดไฟล์ PDF สำเร็จ!', 'success');
            document.body.removeChild(wrapper); // ลบออกเพื่อไม่ให้กินพื้นที่หน่วยความจำ
        });
        
    } catch(e) {
        console.error("Export PDF Error:", e);
        showCustomAlert('ผิดพลาด', 'ไม่สามารถสร้างไฟล์ PDF ได้');
    }
}

// 2. ฟังก์ชันโหลดไฟล์ PDF (ตารางสรุปสินค้าสวยงาม - แก้ปัญหาหน้าขาว 100%)
async function exportProductsPDF() {
    try {
        const products = await dbGetAll('menu');
        if(products.length === 0) {
            showToast('ไม่มีข้อมูลสินค้าเพื่อ Export', 'warning');
            return;
        }
        
        showToast('กำลังสร้าง PDF กรุณารอสักครู่...', 'warning');

        // สร้างเฉพาะโค้ด HTML เตรียมไว้ และกำหนดความกว้าง 800px ให้คงที่
        let html = `
        <div style="font-family: 'Kanit', sans-serif; padding: 20px; color: #333; background-color: #ffffff; width: 800px; max-width: 800px;">
            <h2 style="text-align: center; margin-bottom: 5px; color: #1e3a8a;">รายการสินค้าทั้งหมด</h2>
            <p style="text-align: center; font-size: 12px; color: #666; margin-bottom: 20px;">ข้อมูล ณ วันที่: ${new Date().toLocaleDateString('th-TH')}</p>
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead>
                    <tr style="background-color: #f3f4f6; color: #1f2937;">
                        <th style="border: 1px solid #d1d5db; padding: 8px; text-align: left; width: 20%;">รหัสสินค้า</th>
                        <th style="border: 1px solid #d1d5db; padding: 8px; text-align: left; width: 40%;">ชื่อสินค้า</th>
                        <th style="border: 1px solid #d1d5db; padding: 8px; text-align: left; width: 20%;">หมวดหมู่</th>
                        <th style="border: 1px solid #d1d5db; padding: 8px; text-align: right; width: 20%;">ราคา (฿)</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        products.forEach(p => {
            html += `
            <tr>
                <td style="border: 1px solid #d1d5db; padding: 6px;">${p.id || '-'}</td>
                <td style="border: 1px solid #d1d5db; padding: 6px;">${p.name || '-'}</td>
                <td style="border: 1px solid #d1d5db; padding: 6px;">${p.category || 'ทั่วไป'}</td>
                <td style="border: 1px solid #d1d5db; padding: 6px; text-align: right; font-weight: bold;">${parseFloat(p.price || 0).toLocaleString()}</td>
            </tr>`;
        });
        
        html += `</tbody></table>
                 <p style="text-align: right; font-size: 10px; margin-top: 10px; color: #888;">จำนวนสินค้าทั้งหมด ${products.length} รายการ</p>
                 </div>`;
        
        // ตั้งค่าหน้ากระดาษ PDF (เพิ่ม windowWidth: 800 เข้าไปเพื่อล็อกสเกลภาพให้พอดี)
        const opt = {
            margin:       10,
            filename:     `Product_List_${new Date().toISOString().split('T')[0]}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 800, scrollY: 0 },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        
        // 🟢 สิ่งที่เปลี่ยน: โยนตัวแปร html (ที่เป็นข้อความ) เข้าไปใน .from(html) ตรงๆ เลย
        // ไลบรารีจะทำการจำลองหน้าต่างซ่อนไว้เองโดยไม่สนใจว่าจะโดนเบราว์เซอร์ตัดภาพทิ้ง
        html2pdf().set(opt).from(html).save().then(() => {
            showToast('ดาวน์โหลดไฟล์ PDF สำเร็จ!', 'success');
        });
        
    } catch(e) {
        console.error("Export PDF Error:", e);
        showCustomAlert('ผิดพลาด', 'ไม่สามารถสร้างไฟล์ PDF ได้');
    }
}

function renderPaymentReceipt() {
    const container = document.getElementById('paymentReceiptItems');
    if (!container) return;

    const dateEl = document.getElementById('slipDate');
    const orderNoEl = document.getElementById('slipOrderNo');
    const now = new Date();

    if(dateEl) {
        dateEl.innerText = now.toLocaleDateString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' + now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    
    if (orderNoEl) {
        orderNoEl.innerText = currentPayOrder && currentPayOrder.orderId ? currentPayOrder.orderId : ("W-" + Math.floor(Math.random() * 100000));
    }

    let total = 0;
    let totalQty = 0;
    
    const itemsHtml = cart.map(item => {
        const itemTotal = item.price * item.qty;
        total += itemTotal;
        totalQty += item.qty;
        
        return `
        <div class="leading-tight mb-1">
            <div class="break-words">${item.qty} ${item.name}</div>
            <div class="flex justify-end gap-2 mt-0.5">
                <span class="w-16 text-right">${item.price.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
                <span class="w-16 text-right">${itemTotal.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
            </div>
        </div>`;
    }).join('');

    container.innerHTML = itemsHtml;
    
    const totalFormatted = total.toLocaleString('th-TH', {minimumFractionDigits: 2});
    if(document.getElementById('paymentReceiptTotal')) document.getElementById('paymentReceiptTotal').innerText = totalFormatted;
    if(document.getElementById('paymentReceiptTotal2')) document.getElementById('paymentReceiptTotal2').innerText = totalFormatted;
    if(document.getElementById('slipItemCount')) document.getElementById('slipItemCount').innerText = cart.length;
    if(document.getElementById('slipTotalQty')) document.getElementById('slipTotalQty').innerText = totalQty;
    
    updateSlipChange();
}

function updateSlipChange() {
    const inputEl = document.getElementById('inputReceived');
    const recvEl = document.getElementById('slipReceived');
    const changeEl = document.getElementById('slipChange');
    if (!recvEl || !changeEl) return;
    
    let received = Number(inputEl.value) || 0;
    let total = currentPayOrder ? currentPayOrder.totalPrice : cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
    
    recvEl.innerText = (received === 0 ? "0.00" : received.toLocaleString('th-TH', {minimumFractionDigits: 2}));
    
    let change = received - total;
    if (change < 0 || received === 0) change = 0;
    
    changeEl.innerText = change.toLocaleString('th-TH', {minimumFractionDigits: 2});
}
