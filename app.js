// --- CONFIGURATION ---
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : 'https://finest-smilies-venue-lol.trycloudflare.com'; 
const BOT_USERNAME = 'VerdeCasinoBot'; 

function maskUsername(username) {
    if (!username) return "anonymous";
    let clean = username.startsWith("@") ? username.slice(1) : username;
    if (clean.length <= 1) return clean + "*";
    if (clean.length === 2) return clean[0] + "*";
    return clean[0] + "*".repeat(clean.length - 2) + clean[clean.length - 1];
}

// Инициализация Telegram WebApp
const tg = window.Telegram?.WebApp;
let initData = '';
let currentUser = { id: 0, username: 'Player', first_name: 'Player', balance: 0 };
let currentRoomId = null;
let currentRoomBet = 0;
let lobbySocket = null;
let gameSocket = null;
let roomPollInterval = null;
let activeRooms = [];

// Параметры фильтрации и пагинации
let currentFilterType = 'all'; // 'all', 'own', 'other'
let currentSearchQuery = '';
let currentSortType = 'bet-desc'; // 'bet-asc', 'bet-desc', 'newest'
let currentBetMin = null;
let currentBetMax = null;
let currentPage = 1;
const roomsPerPage = 5;

// Настройка стилей для темы Telegram
if (tg) {
    tg.ready();
    tg.expand();
    initData = tg.initData || '';
    
    // Включаем виброотклик
    if (tg.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
}

// Заглушка для локального тестирования (если запущен вне Telegram)
if (!initData) {
    console.log("⚠️ Running outside Telegram. Injecting mock auth data.");
    const mockUser = {
        id: 99999,
        first_name: "Developer",
        username: "dev_player",
        language_code: "en"
    };
    initData = `mock_${encodeURIComponent(JSON.stringify(mockUser))}`;
}

// Заголовки для авторизованных запросов
const getHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${initData}`
});

// --- ДОМ ЭЛЕМЕНТЫ ---
const elements = {
    usernameDisplay: document.getElementById('username-display'),
    balanceDisplay: document.getElementById('balance-display'),
    roomsList: document.getElementById('rooms-list'),
    
    btnCreateRoom: document.getElementById('btn-create-room'),
    btnClaimGift: document.getElementById('btn-claim-gift'),
    
    createRoomModal: document.getElementById('create-room-modal'),
    btnCloseCreateModal: document.getElementById('btn-close-create-modal'),
    btnConfirmCreate: document.getElementById('btn-confirm-create'),
    inputBet: document.getElementById('input-bet'),
    checkPrivate: document.getElementById('check-private'),
    presetBets: document.querySelectorAll('.btn-preset'),
    
    adModal: document.getElementById('ad-modal'),
    btnCloseAdModal: document.getElementById('btn-close-ad-modal'),
    btnConfirmClaim: document.getElementById('btn-confirm-claim'),
    countdownNumber: document.getElementById('countdown-number'),
    countdownProgress: document.getElementById('countdown-progress'),
    countdownStatusText: document.getElementById('countdown-status-text'),
    
    gameplayScreen: document.getElementById('gameplay-screen'),
    gameRoomId: document.getElementById('game-room-id'),
    namePlayerOwner: document.getElementById('name-player-owner'),
    namePlayerOpponent: document.getElementById('name-player-opponent'),
    diceOwner: document.getElementById('dice-owner'),
    diceOpponent: document.getElementById('dice-opponent'),
    gameStatusText: document.getElementById('game-status-text'),
    
    ownerWaitingActions: document.getElementById('owner-waiting-actions'),
    btnShareRoom: document.getElementById('btn-share-room'),
    btnKeepRoomLobby: document.getElementById('btn-keep-room-lobby'),
    btnLeaveRoom: document.getElementById('btn-leave-room'),
    
    confirmModal: document.getElementById('confirm-modal'),
    btnCloseConfirmModal: document.getElementById('btn-close-confirm-modal'),
    
    // Селекторы фильтрации и пагинации
    searchOwner: document.getElementById('search-owner'),
    sortRooms: document.getElementById('sort-rooms'),
    betMin: document.getElementById('bet-min'),
    betMax: document.getElementById('bet-max'),
    btnPrevPage: document.getElementById('btn-prev-page'),
    btnNextPage: document.getElementById('btn-next-page'),
    pageInfo: document.getElementById('page-info'),
    confirmTitle: document.getElementById('confirm-title'),
    confirmOwner: document.getElementById('confirm-owner'),
    confirmBet: document.getElementById('confirm-bet'),
    confirmMessageText: document.getElementById('confirm-message-text'),
    btnConfirmActionCancel: document.getElementById('btn-confirm-action-cancel'),
    btnConfirmActionSubmit: document.getElementById('btn-confirm-action-submit'),
    
    matchResults: document.getElementById('match-results'),
    resultTitle: document.getElementById('result-title'),
    resultSubtitle: document.getElementById('result-subtitle'),
    btnReturnLobby: document.getElementById('btn-return-lobby'),
    
    toastContainer: document.getElementById('toast-container'),
    // Notifications
    notifBell: document.getElementById('notif-bell'),
    notifPanel: document.getElementById('notif-panel'),
    notifList: document.getElementById('notif-list'),
    notifCloseBtn: document.getElementById('notif-close-btn'),
    userAvatar: document.getElementById('user-avatar'),
    gameAvatarOwner: document.getElementById('game-avatar-owner'),
    gameAvatarOpponent: document.getElementById('game-avatar-opponent'),
    btnToggleFilters: document.getElementById('btn-toggle-filters'),
    expandableFiltersPanel: document.getElementById('expandable-filters-panel'),
    vsRingSvg: document.getElementById('vs-ring-svg'),
};

// --- УВЕДОМЛЕНИЯ ---

function timeAgo(ts) {
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

async function fetchNotifications() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/notifications`, { headers: getHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        
        // Показываем/прячем колокольчик
        if (elements.notifBell) {
            if (data.unread > 0) {
                elements.notifBell.classList.remove('hidden');
            } else {
                elements.notifBell.classList.add('hidden');
            }
        }
        
        // Рендерим список
        renderNotifications(data.notifications);
    } catch (e) {
        // silent fail
    }
}

function renderNotifications(list) {
    if (!elements.notifList) return;
    if (!list || list.length === 0) {
        elements.notifList.innerHTML = '<div class="notif-empty">No games yet</div>';
        return;
    }
    elements.notifList.innerHTML = list.map(n => {
        let icon, titleClass, titleText, sub;
        if (n.is_draw) {
            icon = '🤝'; titleClass = 'draw'; titleText = 'Tie';
            sub = `Bet returned — ${n.bet.toLocaleString()} 🪙 &nbsp;|&nbsp; 🎲 ${n.my_roll} vs ${n.opp_roll}`;
        } else if (n.won) {
            icon = '🏆'; titleClass = 'win'; titleText = 'Victory!';
            sub = `+${(n.bet * 2).toLocaleString()} 🪙 &nbsp;|&nbsp; 🎲 ${n.my_roll} vs ${n.opp_roll}`;
        } else {
            icon = '💀'; titleClass = 'lose'; titleText = 'Defeat';
            sub = `-${n.bet.toLocaleString()} 🪙 &nbsp;|&nbsp; 🎲 ${n.my_roll} vs ${n.opp_roll}`;
        }
        return `
            <div class="notif-item">
                <div class="notif-icon">${icon}</div>
                <div class="notif-body">
                    <div class="notif-title ${titleClass}">${titleText}</div>
                    <div class="notif-sub">${sub}</div>
                </div>
                <div class="notif-time">${timeAgo(n.ts)}</div>
            </div>`;
    }).join('');
}

async function openNotifications() {
    if (!elements.notifPanel) return;
    elements.notifPanel.classList.remove('hidden');
    
    // Сразу скрываем колокольчик и сбрасываем счётчик на сервере
    if (elements.notifBell) elements.notifBell.classList.add('hidden');
    try {
        await fetch(`${API_BASE_URL}/api/notifications/read`, { method: 'POST', headers: getHeaders() });
        // Обновляем список
        await fetchNotifications();
    } catch (e) {}
}

function closeNotifications() {
    if (elements.notifPanel) elements.notifPanel.classList.add('hidden');
}

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (ТОСТЫ) ---
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fa-solid ${type === 'error' ? 'fa-triangle-exclamation' : type === 'success' ? 'fa-circle-check' : 'fa-circle-info'}"></i>
        <span>${message}</span>
    `;
    elements.toastContainer.appendChild(toast);
    
    // Вибрация при ошибках или победах
    if (tg && tg.HapticFeedback) {
        if (type === 'error') tg.HapticFeedback.notificationOccurred('error');
        if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
    }

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- УПРАВЛЕНИЕ АНИМАЦИЕЙ 3D КУБИКОВ ---
// Маппинг значений кубика на соответствующие 3D углы поворота
const diceRotations = {
    1: { x: 0, y: 0 },
    2: { x: 90, y: 0 },
    3: { x: 0, y: 90 },
    4: { x: 0, y: -90 },
    5: { x: -90, y: 0 },
    6: { x: 180, y: 0 }
};

function rollDice(diceElement, targetValue, callback) {
    // Включаем хаотичное вращение
    diceElement.style.transition = 'none';
    diceElement.style.transform = 'rotateX(0deg) rotateY(0deg)';
    
    // Дождемся сброса
    setTimeout(() => {
        diceElement.style.transition = 'transform 1.8s cubic-bezier(0.2, 0.8, 0.3, 1)';
        
        // Вращаем кубик несколько раз вокруг своей оси перед остановкой
        const spins = 4; // Количество полных оборотов
        const rot = diceRotations[targetValue];
        
        const finalX = (spins * 360) + rot.x;
        const finalY = (spins * 360) + rot.y;
        
        diceElement.style.transform = `rotateX(${finalX}deg) rotateY(${finalY}deg)`;
        
        // Вызываем коллбек после завершения анимации
        setTimeout(callback, 1800);
    }, 50);
}

// --- СЕТЕВЫЕ ЗАПРОСЫ (API) ---

async function fetchUserProfile() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/user`, { headers: getHeaders() });
        if (!res.ok) throw new Error("Failed to load profile");
        
        currentUser = await res.json();
        elements.usernameDisplay.textContent = currentUser.username 
            ? `@${currentUser.username}` 
            : currentUser.first_name;
        elements.balanceDisplay.textContent = `${currentUser.balance.toLocaleString()} 🪙`;
        
        // Настройка аватарки пользователя
        const userAvatarElement = document.getElementById('user-avatar');
        if (userAvatarElement) {
            if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.photo_url) {
                userAvatarElement.innerHTML = `<img src="${tg.initDataUnsafe.user.photo_url}" alt="Avatar" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
            } else {
                // Если фото нет, отображаем инициал первой буквы имени пользователя
                const name = currentUser.first_name || currentUser.username || "P";
                userAvatarElement.textContent = name.charAt(0).toUpperCase();
                userAvatarElement.style.fontSize = "20px";
                userAvatarElement.style.fontWeight = "800";
                userAvatarElement.style.color = "var(--black)";
            }
        }
    } catch (e) {
        showToast("Error connecting to server", "error");
        console.error(e);
    }
}

let adTimer = null;
function showAdAndCountdown() {
    elements.adModal.classList.remove('hidden');
    
    // Сбрасываем состояние кнопки
    elements.btnConfirmClaim.classList.add('disabled');
    elements.btnConfirmClaim.disabled = true;
    elements.countdownStatusText.textContent = "Watching sponsor offer...";
    
    let secondsRemaining = 3;
    elements.countdownNumber.textContent = secondsRemaining;
    
    // Сбрасываем прогресс-бар (круг)
    const maxOffset = 188.4;
    elements.countdownProgress.style.strokeDashoffset = maxOffset;
    
    let elapsedMs = 0;
    const totalDurationMs = 3000;
    const intervalMs = 100;
    
    if (adTimer) clearInterval(adTimer);
    
    adTimer = setInterval(() => {
        elapsedMs += intervalMs;
        const progress = Math.min(elapsedMs / totalDurationMs, 1);
        
        // Вычисляем смещение
        const offset = maxOffset - (progress * maxOffset);
        elements.countdownProgress.style.strokeDashoffset = offset;
        
        // Обновляем текст секунд
        const currentSec = Math.ceil((totalDurationMs - elapsedMs) / 1000);
        elements.countdownNumber.textContent = Math.max(currentSec, 0);
        
        if (elapsedMs >= totalDurationMs) {
            clearInterval(adTimer);
            
            // Активируем кнопку получения
            elements.btnConfirmClaim.classList.remove('disabled');
            elements.btnConfirmClaim.disabled = false;
            elements.countdownNumber.textContent = "✓";
            elements.countdownStatusText.textContent = "Reward ready!";
            
            // Тактильный отклик в Telegram о готовности награды
            if (tg && tg.HapticFeedback) {
                tg.HapticFeedback.notificationOccurred('success');
            }
        }
    }, intervalMs);
}

async function claimDailyGift() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/gift`, { 
            method: 'POST', 
            headers: getHeaders() 
        });
        const data = await res.json();
        
        if (!res.ok) {
            showToast(data.detail || "Cannot claim gift", "error");
            return;
        }
        
        showToast(`🎁 Claimed ${data.claimed_amount} coins!`, "success");
        fetchUserProfile();
    } catch (e) {
        showToast("Server connection error", "error");
    }
}

async function fetchActiveRooms() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/rooms`, { headers: getHeaders() });
        if (!res.ok) throw new Error();
        activeRooms = await res.json();
        renderRooms(activeRooms);
    } catch (e) {
        console.error("Failed to fetch rooms list");
    }
}

function renderRooms(rooms) {
    if (!rooms) return;
    
    // 1. Фильтрация
    let filtered = [...rooms];
    
    // Фильтр по типу комнат (все / свои / чужие)
    if (currentFilterType === 'own') {
        filtered = filtered.filter(r => r.owner_id === currentUser.id);
    } else if (currentFilterType === 'other') {
        filtered = filtered.filter(r => r.owner_id !== currentUser.id);
    }
    
    // Поиск по имени создателя
    if (currentSearchQuery) {
        const query = currentSearchQuery.toLowerCase();
        filtered = filtered.filter(r => {
            const username = (r.owner_username || "").toLowerCase();
            return username.includes(query);
        });
    }
    
    // Фильтр по диапазону ставок
    if (currentBetMin !== null && !isNaN(currentBetMin)) {
        filtered = filtered.filter(r => r.bet >= currentBetMin);
    }
    if (currentBetMax !== null && !isNaN(currentBetMax)) {
        filtered = filtered.filter(r => r.bet <= currentBetMax);
    }
    
    // 2. Сортировка
    if (currentSortType === 'bet-asc') {
        filtered.sort((a, b) => a.bet - b.bet);
    } else if (currentSortType === 'bet-desc') {
        filtered.sort((a, b) => b.bet - a.bet);
    } else if (currentSortType === 'newest') {
        filtered.sort((a, b) => b.id.localeCompare(a.id));
    }
    
    // 3. Пагинация
    const totalRooms = filtered.length;
    const totalPages = Math.ceil(totalRooms / roomsPerPage) || 1;
    
    if (currentPage > totalPages) {
        currentPage = totalPages;
    }
    if (currentPage < 1) {
        currentPage = 1;
    }
    
    const startIndex = (currentPage - 1) * roomsPerPage;
    const endIndex = startIndex + roomsPerPage;
    const paginated = filtered.slice(startIndex, endIndex);
    
    // Обновляем кнопки пагинации
    if (elements.btnPrevPage) elements.btnPrevPage.disabled = currentPage === 1;
    if (elements.btnNextPage) elements.btnNextPage.disabled = currentPage === totalPages;
    if (elements.pageInfo) elements.pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    
    if (paginated.length === 0) {
        elements.roomsList.innerHTML = `
            <div class="no-rooms-message">
                <i class="fa-solid fa-gamepad text-muted"></i>
                <p>No matches match your criteria.</p>
            </div>
        `;
        return;
    }
    
    elements.roomsList.innerHTML = paginated.map(room => {
        const isOwn = room.owner_id === currentUser.id;
        const displayName = isOwn 
            ? (room.owner_username ? `@${room.owner_username}` : "You")
            : `@${maskUsername(room.owner_username)}`;
            
        // Если комната принадлежит текущему пользователю, показываем кнопку Cancel
        const actionButton = isOwn
            ? `<button class="btn-join btn-cancel-lobby" onclick="confirmCancelRoom('${room.id}', ${room.bet})">Cancel</button>`
            : `<button class="btn-join" onclick="confirmJoinRoom('${room.id}', '${room.owner_username}', ${room.bet})">Join Game</button>`;
            
        return `
            <div class="room-card-item" id="room-${room.id}">
                <div class="room-info-side">
                    <span class="room-bet-amount">${room.bet.toLocaleString()} 🪙</span>
                    <span class="room-owner-name">by ${displayName}</span>
                </div>
                <div class="room-action-side">
                    ${actionButton}
                </div>
            </div>
        `;
    }).join('');
}

// --- ИГРОВОЙ ПРОЦЕСС ---

async function createRoom(bet, isPrivate) {
    try {
        const res = await fetch(`${API_BASE_URL}/api/rooms/create`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ bet, is_private: isPrivate })
        });
        const data = await res.json();
        
        if (!res.ok) {
            showToast(data.detail || "Failed to create room", "error");
            return;
        }
        
        showToast("Room created successfully!", "success");
        elements.createRoomModal.classList.add('hidden');
        fetchUserProfile();
        
        // Открываем экран ожидания игры
        openGameplayScreen(data.room_id, true, bet);
    } catch (e) {
        showToast("Network error", "error");
    }
}

async function joinRoom(roomId) {
    try {
        // Сразу блокируем интерфейс
        showToast("Connecting to match...", "info");
        
        const res = await fetch(`${API_BASE_URL}/api/rooms/join/${roomId}`, {
            method: 'POST',
            headers: getHeaders()
        });
        const data = await res.json();
        
        if (!res.ok) {
            showToast(data.detail || "Unable to join room", "error");
            return;
        }
        
        // Открываем экран игры для оппонента (который только что зашел)
        openGameplayScreen(roomId, false, data.bet, data);
        
        // Запускаем анимацию броска
        playDiceRoll(data.rolls.owner, data.rolls.opponent, data);
    } catch (e) {
        showToast("Connection failed", "error");
    }
}

function confirmJoinRoom(roomId, ownerUsername, bet) {
    if (elements.confirmTitle) elements.confirmTitle.textContent = "Confirm Match Entry";
    if (elements.confirmOwner) elements.confirmOwner.textContent = `@${maskUsername(ownerUsername)}`;
    if (elements.confirmBet) elements.confirmBet.textContent = `${bet.toLocaleString()} 🪙`;
    if (elements.confirmMessageText) elements.confirmMessageText.textContent = "Are you sure you want to join this room? The bet amount will be immediately deducted from your balance.";
    if (elements.confirmModal) elements.confirmModal.classList.remove('hidden');
    
    if (elements.btnConfirmActionSubmit) {
        elements.btnConfirmActionSubmit.onclick = () => {
            if (elements.confirmModal) elements.confirmModal.classList.add('hidden');
            joinRoom(roomId);
        };
    }
}

function confirmCancelRoom(roomId, bet) {
    if (elements.confirmTitle) elements.confirmTitle.textContent = "Cancel Match Creation";
    if (elements.confirmOwner) elements.confirmOwner.textContent = "You (Owner)";
    if (elements.confirmBet) elements.confirmBet.textContent = `${bet.toLocaleString()} 🪙`;
    if (elements.confirmMessageText) elements.confirmMessageText.textContent = "Are you sure you want to cancel this room? Your bet will be fully refunded to your balance.";
    if (elements.confirmModal) elements.confirmModal.classList.remove('hidden');
    
    if (elements.btnConfirmActionSubmit) {
        elements.btnConfirmActionSubmit.onclick = async () => {
            if (elements.confirmModal) elements.confirmModal.classList.add('hidden');
            try {
                const res = await fetch(`${API_BASE_URL}/api/rooms/delete/${roomId}`, {
                    method: 'POST',
                    headers: getHeaders()
                });
                const data = await res.json();
                
                if (!res.ok) {
                    showToast(data.detail || "Unable to delete room", "error");
                    return;
                }
                
                showToast("Room cancelled and bet refunded!", "success");
                fetchUserProfile();
                fetchActiveRooms();
            } catch (e) {
                showToast("Network error", "error");
            }
        };
    }
}

function confirmDeleteRoom() {
    if (!currentRoomId) return;
    
    if (elements.confirmTitle) elements.confirmTitle.textContent = "Delete & Leave Room";
    if (elements.confirmOwner) elements.confirmOwner.textContent = "You (Owner)";
    if (elements.confirmBet) elements.confirmBet.textContent = `${currentRoomBet ? currentRoomBet.toLocaleString() : '0'} 🪙`;
    if (elements.confirmMessageText) elements.confirmMessageText.textContent = "Are you sure you want to delete this room and leave? Your bet will be fully refunded to your balance.";
    if (elements.confirmModal) elements.confirmModal.classList.remove('hidden');
    
    if (elements.btnConfirmActionSubmit) {
        elements.btnConfirmActionSubmit.onclick = () => {
            if (elements.confirmModal) elements.confirmModal.classList.add('hidden');
            leaveRoom();
        };
    }
}

function setRoomFilter(filterType) {
    currentFilterType = filterType;
    
    const buttons = ['all', 'own', 'other'];
    buttons.forEach(b => {
        const btn = document.getElementById(`btn-filter-${b}`);
        if (btn) {
            if (b === filterType) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
    
    currentPage = 1;
    renderRooms(activeRooms);
}

function changePage(direction) {
    currentPage += direction;
    renderRooms(activeRooms);
}

function applyFiltersAndRender() {
    if (elements.betMin) {
        const val = parseInt(elements.betMin.value);
        currentBetMin = isNaN(val) ? null : val;
    }
    if (elements.betMax) {
        const val = parseInt(elements.betMax.value);
        currentBetMax = isNaN(val) ? null : val;
    }
    currentPage = 1;
    renderRooms(activeRooms);
}

async function leaveRoom() {
    if (!currentRoomId) return;
    try {
        const res = await fetch(`${API_BASE_URL}/api/rooms/delete/${currentRoomId}`, {
            method: 'POST',
            headers: getHeaders()
        });
        const data = await res.json();
        
        if (!res.ok) {
            showToast(data.detail || "Unable to delete room", "error");
            return;
        }
        
        showToast("Room deleted and bet refunded!", "success");
        
        // Закрываем сокет комнаты
        if (gameSocket) {
            gameSocket.close();
            gameSocket = null;
        }
        
        // Возвращаемся в лобби
        elements.gameplayScreen.classList.add('hidden');
        elements.ownerWaitingActions.classList.add('hidden');
        fetchUserProfile();
        fetchActiveRooms();
    } catch (e) {
        showToast("Connection error", "error");
    }
}

function shareRoom() {
    if (!currentRoomId) return;
    const shareUrl = `https://t.me/share/url?url=https://t.me/${BOT_USERNAME}?start=join_${currentRoomId}&text=🎲 Join my Dice match! Low roll wins, bets are returned on tie. Let's play! 🪙`;
    
    if (tg && tg.openTelegramLink) {
        tg.openTelegramLink(shareUrl);
    } else {
        // Копируем в буфер обмена вне Telegram
        navigator.clipboard.writeText(`https://t.me/${BOT_USERNAME}?start=join_${currentRoomId}`).then(() => {
            showToast("Invite link copied to clipboard!", "success");
        }).catch(() => {
            showToast("Unable to copy link", "error");
        });
    }
}

function openGameplayScreen(roomId, isOwner, bet, result = null) {
    currentRoomId = roomId;
    currentRoomBet = bet;
    
    // Сбрасываем старый опрос, если он был активен
    if (roomPollInterval) {
        clearInterval(roomPollInterval);
        roomPollInterval = null;
    }
    
    if (elements.gameRoomId) elements.gameRoomId.textContent = `Room ID: ${roomId}`;
    if (elements.gameplayScreen) elements.gameplayScreen.classList.remove('hidden');
    if (elements.matchResults) elements.matchResults.classList.add('hidden');
    if (elements.gameStatusText) elements.gameStatusText.classList.remove('hidden');
    
    // Скрываем короны при входе
    const crownOwner = document.getElementById('crown-owner');
    const crownOpponent = document.getElementById('crown-opponent');
    if (crownOwner) crownOwner.classList.add('hidden');
    if (crownOpponent) crownOpponent.classList.add('hidden');

    // Сбрасываем 3D кости на грань "1"
    if (elements.diceOwner) elements.diceOwner.style.transform = 'rotateX(0deg) rotateY(0deg)';
    if (elements.diceOpponent) elements.diceOpponent.style.transform = 'rotateX(0deg) rotateY(0deg)';
    
    // Функция установки аватара в игровой карточке
    const setGameAvatar = (element, isMe, username, firstName) => {
        if (!element) return;
        if (isMe && tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.photo_url) {
            element.innerHTML = `<img src="${tg.initDataUnsafe.user.photo_url}" alt="Avatar" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
            element.style.background = "none";
            element.style.border = "none";
        } else {
            // Плейсхолдер с инициалом
            const name = firstName || username || "P";
            element.innerHTML = `<span>${name.charAt(0).toUpperCase()}</span>`;
            element.style.background = "var(--panel-bg)";
            element.style.border = "1px solid var(--panel-border)";
            element.style.fontSize = "20px";
            element.style.fontWeight = "800";
            element.style.color = "var(--white)";
            element.style.display = "flex";
            element.style.alignItems = "center";
            element.style.justifyContent = "center";
        }
    };

    if (isOwner) {
        if (elements.namePlayerOwner) elements.namePlayerOwner.textContent = currentUser.username || currentUser.first_name;
        if (elements.namePlayerOpponent) elements.namePlayerOpponent.textContent = "Waiting...";
        setGameAvatar(elements.gameAvatarOwner, true, currentUser.username, currentUser.first_name);
        
        // Сбрасываем аватарку оппонента на дефолтную иконку
        if (elements.gameAvatarOpponent) {
            elements.gameAvatarOpponent.innerHTML = `<i class="fa-solid fa-user-ninja"></i>`;
            elements.gameAvatarOpponent.style.background = "";
            elements.gameAvatarOpponent.style.border = "";
        }
        
        if (elements.gameStatusText) elements.gameStatusText.textContent = "Waiting for an opponent to join...";
        if (elements.ownerWaitingActions) elements.ownerWaitingActions.classList.remove('hidden'); // Показываем кнопки создателя
        
        // Запускаем надежный HTTP-опрос
        startRoomPolling(roomId);
    } else {
        const ownerName = (result && result.usernames && result.usernames.owner) 
            ? result.usernames.owner 
            : "Opponent";
        if (elements.namePlayerOwner) elements.namePlayerOwner.textContent = ownerName;
        if (elements.namePlayerOpponent) elements.namePlayerOpponent.textContent = currentUser.username || currentUser.first_name;
        
        setGameAvatar(elements.gameAvatarOpponent, true, currentUser.username, currentUser.first_name);
        
        // Аватарка владельца комнаты (плейсхолдер с первой буквой имени)
        setGameAvatar(elements.gameAvatarOwner, false, ownerName, ownerName);
        
        if (elements.gameStatusText) elements.gameStatusText.textContent = "Rolling the dice...";
        if (elements.ownerWaitingActions) elements.ownerWaitingActions.classList.add('hidden'); // Скрываем кнопки создателя
    }
}

function playDiceRoll(ownerRoll, opponentRoll, gameResult) {
    if (elements.ownerWaitingActions) elements.ownerWaitingActions.classList.add('hidden'); // Скрываем кнопки создателя при броске
    if (elements.gameStatusText) elements.gameStatusText.textContent = "🎲 Shaking the cups...";
    
    if (tg && tg.HapticFeedback) {
        // Симулируем тряску вибрацией
        let shakes = 0;
        const shakeInterval = setInterval(() => {
            tg.HapticFeedback.impactOccurred('light');
            shakes++;
            if (shakes > 6) clearInterval(shakeInterval);
        }, 150);
    }
    
    // Запускаем 3D анимацию броска кубиков
    if (elements.diceOwner) rollDice(elements.diceOwner, ownerRoll, () => {});
    if (elements.diceOpponent) {
        rollDice(elements.diceOpponent, opponentRoll, () => {
            // Показ результатов после завершения вращения
            if (elements.gameStatusText) elements.gameStatusText.classList.add('hidden');
            showGameResults(gameResult);
        });
    }
}

function showGameResults(result) {
    if (elements.matchResults) elements.matchResults.classList.remove('hidden');
    const isWinner = result.winner_id === currentUser.id;
    
    // Определяем победителя и показываем корону над нужным аватаром
    const crownOwner = document.getElementById('crown-owner');
    const crownOpponent = document.getElementById('crown-opponent');
    if (crownOwner) crownOwner.classList.add('hidden');
    if (crownOpponent) crownOpponent.classList.add('hidden');
    
    if (result.is_draw) {
        if (elements.matchResults) elements.matchResults.className = "match-results-box draw";
        if (elements.resultTitle) elements.resultTitle.textContent = "🤝 Tie roll!";
        if (elements.resultSubtitle) elements.resultSubtitle.textContent = "All bets returned.";
    } else {
        // У кого сумма очков кубика меньше, тот победил (по правилам игры)
        const ownerWon = result.rolls.owner < result.rolls.opponent;
        if (ownerWon) {
            if (crownOwner) crownOwner.classList.remove('hidden');
        } else {
            if (crownOpponent) crownOpponent.classList.remove('hidden');
        }

        if (isWinner) {
            if (elements.matchResults) elements.matchResults.className = "match-results-box victory";
            if (elements.resultTitle) elements.resultTitle.textContent = "🏆 Victory!";
            if (elements.resultSubtitle) elements.resultSubtitle.textContent = `+${(result.bet * 2).toLocaleString()} coins`;
            if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        } else {
            if (elements.matchResults) elements.matchResults.className = "match-results-box defeat";
            if (elements.resultTitle) elements.resultTitle.textContent = "🌚 Defeat";
            if (elements.resultSubtitle) elements.resultSubtitle.textContent = `-${result.bet.toLocaleString()} coins`;
            if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
        }
    }
    
    // Обновляем профиль с новым балансом
    fetchUserProfile();
}

// --- WEBSOCKETS СОЕДИНЕНИЯ ---

function connectLobbySocket() {
    try {
        const wsUrl = API_BASE_URL.replace(/^http/, 'ws');
        lobbySocket = new WebSocket(`${wsUrl}/api/ws/lobby`);
        
        lobbySocket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'room_created') {
                    if (!activeRooms.some(r => r.id === msg.room.id)) {
                        activeRooms.push(msg.room);
                        renderRooms(activeRooms);
                    }
                } else if (msg.type === 'room_deleted') {
                    activeRooms = activeRooms.filter(r => r.id !== msg.room_id);
                    renderRooms(activeRooms);
                }
            } catch (err) {
                console.error("Error parsing lobby message:", err);
            }
        };
        
        lobbySocket.onclose = () => {
            console.log("Lobby socket closed. Reconnecting...");
            setTimeout(connectLobbySocket, 3000);
        };
        
        lobbySocket.onerror = (err) => {
            console.error("Lobby WebSocket error:", err);
        };
    } catch (e) {
        console.error("Failed to initialize lobby WebSocket:", e);
        setTimeout(connectLobbySocket, 5000);
    }
}

function startRoomPolling(roomId) {
    if (roomPollInterval) {
        clearInterval(roomPollInterval);
        roomPollInterval = null;
    }
    
    const POLL_INTERVAL_MS = 10000; // 10 секунд на один оборот
    const TICK_MS = 50;             // Обновление прогресса каждые 50мс
    const CIRCUMFERENCE = 213.6;   // 2 * PI * r (r=34)
    
    const ringEl = document.getElementById('vs-ring-fill');
    const wrapperEl = document.getElementById('vs-ring-wrapper');
    
    let elapsed = 0;
    let isGameFinished = false;
    
    function stopPolling() {
        if (roomPollInterval) {
            clearInterval(roomPollInterval);
            roomPollInterval = null;
        }
        // Скрываем кольцо
        if (wrapperEl) wrapperEl.style.opacity = '0';
    }
    
    async function checkRoomStatus() {
        if (isGameFinished) return;
        
        // Проверяем, ещё ли мы в экране ожидания
        if (currentRoomId !== roomId ||
            !elements.gameplayScreen ||
            elements.gameplayScreen.classList.contains('hidden') ||
            (elements.matchResults && !elements.matchResults.classList.contains('hidden'))) {
            stopPolling();
            return;
        }
        
        try {
            const res = await fetch(`${API_BASE_URL}/api/rooms/status/${roomId}`, {
                headers: getHeaders()
            });
            if (!res.ok) return;
            const data = await res.json();
            
            if (data.status === 'finished' && data.result) {
                isGameFinished = true;
                stopPolling();
                
                const result = data.result;
                const oppName = (result.usernames && result.usernames.opponent)
                    ? result.usernames.opponent
                    : "Opponent";
                if (elements.namePlayerOpponent) {
                    elements.namePlayerOpponent.textContent = oppName;
                }
                
                // Обновляем аватарку соперника (так как он только что зашел и игра рассчиталась)
                if (elements.gameAvatarOpponent) {
                    elements.gameAvatarOpponent.innerHTML = `<span>${oppName.charAt(0).toUpperCase()}</span>`;
                    elements.gameAvatarOpponent.style.background = "var(--panel-bg)";
                    elements.gameAvatarOpponent.style.border = "1px solid var(--panel-border)";
                    elements.gameAvatarOpponent.style.fontSize = "20px";
                    elements.gameAvatarOpponent.style.fontWeight = "800";
                    elements.gameAvatarOpponent.style.color = "var(--white)";
                    elements.gameAvatarOpponent.style.display = "flex";
                    elements.gameAvatarOpponent.style.alignItems = "center";
                    elements.gameAvatarOpponent.style.justifyContent = "center";
                }
                
                playDiceRoll(result.rolls.owner, result.rolls.opponent, result);
                
            } else if (data.status === 'not_found') {
                isGameFinished = true;
                stopPolling();
                showToast("Room was deleted", "warning");
                if (elements.gameplayScreen) elements.gameplayScreen.classList.add('hidden');
                fetchActiveRooms();
            }
        } catch (e) {
            console.error("[POLL GAME] Error checking room status:", e);
        }
    }
    
    // Показываем кольцо плавно
    if (wrapperEl) wrapperEl.style.opacity = '1';
    
    // Тик: обновляем прогресс-кольцо каждые 50мс
    roomPollInterval = setInterval(async () => {
        if (isGameFinished) { stopPolling(); return; }
        
        // Проверяем выход с экрана
        if (currentRoomId !== roomId ||
            !elements.gameplayScreen ||
            elements.gameplayScreen.classList.contains('hidden') ||
            (elements.matchResults && !elements.matchResults.classList.contains('hidden'))) {
            stopPolling();
            return;
        }
        
        elapsed += TICK_MS;
        
        // Общий прогресс 10-секундного цикла от 0 до 1
        const totalProgress = (elapsed % POLL_INTERVAL_MS) / POLL_INTERVAL_MS;
        
        // Номер текущей четверти (0, 1, 2, 3) за 10-секундный интервал
        const quarterIndex = Math.floor(totalProgress * 4);
        
        // Прогресс внутри текущей 2.5-секундной пробежки (от 0 до 1)
        const subProgress = (totalProgress * 4) % 1;
        
        // Максимальная длина "червя" на пике (середина пути) - четверть окружности (25% от 213.6 = 53.4)
        const maxWormLength = CIRCUMFERENCE * 0.25;
        
        // Длина червя динамическая: 0 на старте, растет до maxWormLength в центре (0.5), сжимается до 0 в конце (1.0)
        // Используем синус для мягкого изменения ширины
        const currentLength = maxWormLength * Math.sin(subProgress * Math.PI);
        
        // Базовый поворот (стартовая точка четверти): 0, 90, 180, 270 градусов
        const baseAngleDeg = quarterIndex * 90;
        
        // Добавочный поворот пробежки: за один пробег проходит 360 (полный круг) + 90 (четверть вперед) = 450 градусов
        const runAngleDeg = subProgress * 450;
        
        // Итоговый угол поворота SVG элемента в градусах (с учетом начального сдвига на -90 градусов)
        const totalAngle = -90 + baseAngleDeg + runAngleDeg;
        
        // Устанавливаем динамическую длину линии и смещение через dasharray
        if (ringEl) {
            // Линия длиной currentLength, остальная часть окружности пустая
            ringEl.style.strokeDasharray = `${currentLength} ${CIRCUMFERENCE - currentLength}`;
            // Устанавливаем смещение равным 0, так как мы вращаем сам SVG контейнер для перемещения
            ringEl.style.strokeDashoffset = '0';
        }
        
        if (elements.vsRingSvg) {
            elements.vsRingSvg.style.transform = `rotate(${totalAngle}deg)`;
        }
        
        // Когда достигли конца 10-секундного цикла — делаем запрос
        if (elapsed % POLL_INTERVAL_MS < TICK_MS) {
            elapsed = Math.round(elapsed / POLL_INTERVAL_MS) * POLL_INTERVAL_MS;
            await checkRoomStatus();
        }
    }, TICK_MS);
}

// --- ИВЕНТ ХЕНДЛЕРЫ ---

// Управление модальным окном
elements.btnCreateRoom.onclick = () => {
    elements.createRoomModal.classList.remove('hidden');
    elements.inputBet.focus();
};

elements.btnCloseCreateModal.onclick = () => {
    elements.createRoomModal.classList.add('hidden');
};

// Выбор готовых пресетов ставок
elements.presetBets.forEach(btn => {
    btn.onclick = () => {
        elements.presetBets.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        elements.inputBet.value = btn.dataset.val;
    };
});

// Кнопка подтверждения создания комнаты
if (elements.btnConfirmCreate) {
    elements.btnConfirmCreate.onclick = () => {
        const bet = parseInt(elements.inputBet.value);
        const isPrivate = elements.checkPrivate.checked;
        
        if (isNaN(bet) || bet <= 0) {
            showToast("Enter a valid bet amount", "error");
            return;
        }
        
        if (bet > currentUser.balance) {
            showToast("Insufficient balance", "error");
            return;
        }
        
        createRoom(bet, isPrivate);
    };
}

if (elements.btnClaimGift) {
    elements.btnClaimGift.onclick = () => {
        showAdAndCountdown();
    };
}

if (elements.btnCloseAdModal) {
    elements.btnCloseAdModal.onclick = () => {
        if (adTimer) clearInterval(adTimer);
        elements.adModal.classList.add('hidden');
    };
}

if (elements.btnConfirmClaim) {
    elements.btnConfirmClaim.onclick = () => {
        elements.adModal.classList.add('hidden');
        claimDailyGift();
    };
}

if (elements.btnShareRoom) {
    elements.btnShareRoom.onclick = () => {
        shareRoom();
    };
}

if (elements.btnKeepRoomLobby) {
    elements.btnKeepRoomLobby.onclick = () => {
        if (gameSocket) {
            gameSocket.close();
            gameSocket = null;
        }
        elements.gameplayScreen.classList.add('hidden');
        elements.ownerWaitingActions.classList.add('hidden');
        fetchActiveRooms();
    };
}

if (elements.btnLeaveRoom) {
    elements.btnLeaveRoom.onclick = () => {
        confirmDeleteRoom();
    };
}

if (elements.btnCloseConfirmModal) {
    elements.btnCloseConfirmModal.onclick = () => {
        if (elements.confirmModal) elements.confirmModal.classList.add('hidden');
    };
}

if (elements.btnConfirmActionCancel) {
    elements.btnConfirmActionCancel.onclick = () => {
        if (elements.confirmModal) elements.confirmModal.classList.add('hidden');
    };
}

if (elements.btnReturnLobby) {
    elements.btnReturnLobby.onclick = () => {
        elements.gameplayScreen.classList.add('hidden');
        fetchActiveRooms();
    };
}

// Слушатели для фильтрации и сортировки
if (elements.searchOwner) {
    elements.searchOwner.oninput = (e) => {
        currentSearchQuery = e.target.value;
        currentPage = 1;
        renderRooms(activeRooms);
    };
}

if (elements.sortRooms) {
    elements.sortRooms.onchange = (e) => {
        currentSortType = e.target.value;
        currentPage = 1;
        renderRooms(activeRooms);
    };
}

if (elements.btnToggleFilters) {
    elements.btnToggleFilters.onclick = () => {
        if (elements.expandableFiltersPanel) {
            const isHidden = elements.expandableFiltersPanel.classList.toggle('hidden');
            elements.btnToggleFilters.classList.toggle('active', !isHidden);
        }
    };
}

// Экспортируем функции для inline вызова из HTML
window.joinRoom = joinRoom;
window.confirmJoinRoom = confirmJoinRoom;
window.confirmCancelRoom = confirmCancelRoom;
window.confirmDeleteRoom = confirmDeleteRoom;
window.startRoomPolling = startRoomPolling;
window.setRoomFilter = setRoomFilter;
window.changePage = changePage;
window.applyFiltersAndRender = applyFiltersAndRender;

// --- ИНИЦИАЛИЗАЦИЯ ПРИ ЗАПУСКЕ ---
fetchUserProfile();
fetchActiveRooms();
connectLobbySocket();
fetchNotifications();

// Клик по аватарке — открыть/закрыть уведомления
if (elements.userAvatar) {
    elements.userAvatar.onclick = () => {
        if (elements.notifPanel && elements.notifPanel.classList.contains('hidden')) {
            openNotifications();
        } else {
            closeNotifications();
        }
    };
}

// Кнопка закрытия панели уведомлений
if (elements.notifCloseBtn) {
    elements.notifCloseBtn.onclick = () => closeNotifications();
}
