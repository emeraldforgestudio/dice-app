// --- CONFIGURATION ---
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : 'https://finest-smilies-venue-lol.trycloudflare.com'; 
let BOT_USERNAME = 'VerdeCasinoBot'; 

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
let currentUser = { id: 0, username: 'Player', first_name: 'Player', balance: 0, bonus_cooldown: null };
let currentRoomId = null;
let currentRoomBet = 0;
let weAreRoomOwner = false;
let lobbySocket = null;
let gameSocket = null;
let roomPollInterval = null;
let activeRooms = [];
let lastRenderedRoomsHash = "";
let welcomeChecked = false;

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
    btnSystemShare: document.getElementById('btn-system-share'),
    btnTgInvite: document.getElementById('btn-tg-invite'),
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
    userAvatarWrapper: document.getElementById('user-avatar-wrapper'),
    gameAvatarOwner: document.getElementById('game-avatar-owner'),
    gameAvatarOpponent: document.getElementById('game-avatar-opponent'),
    btnToggleFilters: document.getElementById('btn-toggle-filters'),
    expandableFiltersPanel: document.getElementById('expandable-filters-panel'),
    vsRingSvg: document.getElementById('vs-ring-svg'),
    vsBadgeText: document.getElementById('vs-badge-text'),
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
        const res = await fetch(`${API_BASE_URL}/api/notifications?t=${Date.now()}`, { headers: getHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        
        // Показываем/прячем колокольчик
        if (elements.notifBell) {
            const hasNotifications = data.notifications && data.notifications.length > 0;
            if (data.unread > 0 && hasNotifications) {
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
        let icon = '🔔', titleClass = '', titleText = 'Notification', sub = '';
        try {
            if (n.type === 'league_prize') {
                icon = '🏆'; 
                titleClass = 'win'; 
                titleText = `League Prize!`;
                sub = `Rank #${n.rank} &nbsp;|&nbsp; +${(n.prize || 0).toLocaleString()} 🪙`;
            } else if (n.type === 'room_created') {
                icon = `<i class="fa-solid fa-plus" style="color: var(--emerald); font-size: 15px;"></i>`; 
                titleClass = 'green'; 
                titleText = `Room Created`;
                sub = `Room ID: <code>${n.room_id}</code>`;
            } else if (n.type === 'room_deleted') {
                icon = `<i class="fa-solid fa-xmark" style="color: var(--danger-red); font-size: 15px;"></i>`; 
                titleClass = 'orange'; 
                titleText = `Room Cancelled`;
                sub = `Room ID: <code>${n.room_id}</code>`;
            } else if (n.is_draw) {
                icon = '🤝'; titleClass = 'draw'; titleText = 'Tie';
                sub = `Bet returned — ${(n.bet || 0).toLocaleString()} 🪙 &nbsp;|&nbsp; 🎲 ${n.my_roll || 0} vs ${n.opp_roll || 0}`;
            } else if (n.won) {
                icon = '🏆'; titleClass = 'win'; titleText = 'Victory!';
                sub = `+${((n.bet || 0) * 2).toLocaleString()} 🪙 &nbsp;|&nbsp; 🎲 ${n.my_roll || 0} vs ${n.opp_roll || 0}`;
            } else {
                icon = '💀'; titleClass = 'lose'; titleText = 'Defeat';
                sub = `-${(n.bet || 0).toLocaleString()} 🪙 &nbsp;|&nbsp; 🎲 ${n.my_roll || 0} vs ${n.opp_roll || 0}`;
            }
        } catch (err) {
            console.error("Failed to render notification:", err, n);
            sub = "Game notification";
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

function handleApiResponse(res, data, defaultErrorMsg = "An error occurred") {
    if (res.ok) return true;
    
    const errorMsg = data && data.detail ? data.detail : defaultErrorMsg;
    
    // Если статус 429 (Too Many Requests), показываем нативный Telegram Alert
    if (res.status === 429) {
        if (tg && tg.showAlert) {
            tg.showAlert(errorMsg);
        } else {
            alert(errorMsg);
        }
    } else {
        // Обычные ошибки показываем тостом
        showToast(errorMsg, "error");
    }
    return false;
}

// --- УПРАВЛЕНИЕ АНИМАЦИЕЙ 3D КУБИКОВ ---
// Маппинг значений кубика на соответствующие 3D углы поворота
const diceRotations = {
    1: { x: 0, y: 0 },
    2: { x: 90, y: 0 },
    3: { x: 0, y: -90 },
    4: { x: 0, y: 90 },
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
        const res = await fetch(`${API_BASE_URL}/api/user?t=${Date.now()}`, { headers: getHeaders() });
        const data = await res.json();
        
        if (!handleApiResponse(res, data, "Failed to load profile")) {
            return;
        }
        
        currentUser = data;
        if (typeof checkAndShowWelcome === 'function') {
            checkAndShowWelcome();
        }
        if (data.bot_username) {
            BOT_USERNAME = data.bot_username;
        }
        elements.usernameDisplay.textContent = currentUser.username 
            ? `@${currentUser.username}` 
            : currentUser.first_name;
        elements.balanceDisplay.textContent = `${currentUser.balance.toLocaleString()} 🪙`;
        
        // Обновляем баланс в результатах матча, если элемент существует
        const matchBalEl = document.getElementById('match-new-balance');
        if (matchBalEl) {
            matchBalEl.textContent = `${currentUser.balance.toLocaleString()} 🪙`;
        }
        
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
        
        if (!handleApiResponse(res, data, "Cannot claim gift")) {
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
        const res = await fetch(`${API_BASE_URL}/api/rooms?t=${Date.now()}`, { headers: getHeaders() });
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

    // Проверяем, изменился ли контент комнат на текущей странице, чтобы избежать лишней перерисовки DOM
    const renderHash = paginated.map(r => `${r.id}:${r.bet}:${r.owner_username}:${r.is_private}`).join('|');
    if (renderHash === lastRenderedRoomsHash) {
        return;
    }
    lastRenderedRoomsHash = renderHash;
    
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
            : `<button class="btn-join" onclick="confirmJoinRoom('${room.id}', '${room.owner_username}', ${room.bet})">Join Bet</button>`;
            
        const isPrivate = room.is_private === true;
        const privateBadge = isPrivate 
            ? `<span class="private-badge"><i class="fa-solid fa-eye-slash"></i> Hidden</span>`
            : '';
            
        return `
            <div class="room-card-item ${isPrivate ? 'private-room-card' : ''}" id="room-${room.id}">
                <div class="room-info-side">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="room-bet-amount">${room.bet.toLocaleString()} 🪙</span>
                        ${privateBadge}
                    </div>
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
        
        if (!handleApiResponse(res, data, "Failed to create room")) {
            return;
        }
        
        const roomsLeftText = data.rooms_left !== undefined ? ` (${data.rooms_left} rooms left)` : "";
        showToast(`Room created successfully!${roomsLeftText}`, "success");
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
        
        if (!handleApiResponse(res, data, "Unable to join room")) {
            // Восстанавливаем карточку комнаты при ошибке входа
            const roomEl = document.getElementById(`room-${roomId}`);
            if (roomEl) {
                roomEl.style.opacity = '';
                roomEl.style.pointerEvents = '';
                const btn = roomEl.querySelector('.btn-join');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Join Bet';
                }
            }
            return;
        }
        
        // Открываем экран игры для оппонента (который только что зашел)
        openGameplayScreen(roomId, false, data.bet, data);
        
        // Запускаем анимацию броска
        playDiceRoll(data.rolls.owner, data.rolls.opponent, data);
    } catch (e) {
        showToast("Connection failed", "error");
        // Восстанавливаем карточку комнаты при ошибке соединения
        const roomEl = document.getElementById(`room-${roomId}`);
        if (roomEl) {
            roomEl.style.opacity = '';
            roomEl.style.pointerEvents = '';
            const btn = roomEl.querySelector('.btn-join');
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Join Bet';
            }
        }
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
            
            // Визуально отключаем карточку комнаты немедленно
            const roomEl = document.getElementById(`room-${roomId}`);
            if (roomEl) {
                roomEl.style.opacity = '0.5';
                roomEl.style.pointerEvents = 'none';
                const btn = roomEl.querySelector('.btn-join');
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = 'Joining...';
                }
            }
            
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
                
                if (!handleApiResponse(res, data, "Unable to delete room")) {
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
        
        if (!handleApiResponse(res, data, "Unable to delete room")) {
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
        syncLobbyData();
    } catch (e) {
        showToast("Connection error", "error");
    }
}

function legacyCopy(text) {
    try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.width = "2em";
        textArea.style.height = "2em";
        textArea.style.padding = "0";
        textArea.style.border = "none";
        textArea.style.outline = "none";
        textArea.style.boxShadow = "none";
        textArea.style.background = "transparent";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        return successful;
    } catch (err) {
        console.error("Legacy copy failed: ", err);
        return false;
    }
}

function copyTextToClipboard(text) {
    return new Promise((resolve, reject) => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(resolve)
                .catch((err) => {
                    if (legacyCopy(text)) resolve();
                    else reject(err);
                });
        } else {
            if (legacyCopy(text)) resolve();
            else reject(new Error("Clipboard API not supported"));
        }
    });
}

// Backup of the original share message parameters
const TG_INVITE_BACKUP = {
    url: "https://t.me/{BOT_USERNAME}?start=join_{ROOM_ID}",
    text: "🎲 Join my room in Dice Arena and let's roll! Low roll wins. 🪙"
};

// New message configuration containing the link as a button, designed beautifully
const TG_INVITE_NEW = {
    title: "Dice Arena Invitation",
    text: "🤝 You are invited to a Dice Arena Match!\n\n💰 Bet: {BET} 🪙\n📜 Rules: Lowest roll takes the whole pot.",
    buttonText: "Play 🎲",
    url: "https://t.me/{BOT_USERNAME}?start=join_{ROOM_ID}"
};

function tgInvite() {
    if (!currentRoomId) return;

    let success = false;
    if (tg && tg.switchInlineQuery) {
        try {
            // Check if client supports choosing specific chat types (API 6.7+)
            if (tg.isVersionAtLeast && tg.isVersionAtLeast('6.7')) {
                tg.switchInlineQuery(`join_${currentRoomId}`, ['users', 'chats', 'groups', 'channels']);
                success = true;
            } else {
                tg.switchInlineQuery(`join_${currentRoomId}`);
                success = true;
            }
        } catch (e) {
            console.error("switchInlineQuery failed:", e);
        }
    }

    if (!success) {
        // Fallback to standard share if switchInlineQuery is not supported or failed
        const url = TG_INVITE_BACKUP.url.replace('{BOT_USERNAME}', BOT_USERNAME).replace('{ROOM_ID}', currentRoomId);
        const betVal = typeof currentRoomBet !== 'undefined' && currentRoomBet ? `${currentRoomBet.toLocaleString()} 🪙` : "some";
        const text = `🎲 VERDE Dice Match!\n━━━━━━━━━━━━━━━━━━\n🤝 You are invited to play!\n💰 Bet: ${betVal}\n📜 Rules: Lowest roll wins (⚀ beats ⚅)\n\n👉 Click here to join:\n`;

        const telegramShareFallback = () => {
            const shareUrl = `https://t.me/share/url?url=&text=${encodeURIComponent(text + "\n" + url)}`;
            if (tg && tg.openTelegramLink) {
                tg.openTelegramLink(shareUrl);
            } else {
                showToast("Unable to open share menu", "error");
            }
        };

        if (navigator.share) {
            navigator.share({
                title: 'Dice Arena Match',
                text: text + "\n" + url
            }).catch((err) => {
                console.log("Share failed or cancelled:", err);
                telegramShareFallback();
            });
        } else {
            telegramShareFallback();
        }
    }
}

function systemShare() {
    if (!currentRoomId) return;
    const url = `https://t.me/${BOT_USERNAME}?start=join_${currentRoomId}`;
    const betVal = typeof currentRoomBet !== 'undefined' && currentRoomBet ? `${currentRoomBet.toLocaleString()} 🪙` : "some";
    const text = `🎲 VERDE Dice Match!\n━━━━━━━━━━━━━━━━━━\n🤝 You are invited to play!\n💰 Bet: ${betVal}\n📜 Rules: Lowest roll wins (⚀ beats ⚅)\n\n👉 Click here to join:\n`;
    
    const fallbackCopyAndShare = () => {
        copyTextToClipboard(url).then(() => {
            showToast("Link copied! Opening share menu...", "success");
            const shareUrl = `https://t.me/share/url?url=&text=${encodeURIComponent(text + "\n\n" + url)}`;
            if (tg && tg.openTelegramLink) {
                tg.openTelegramLink(shareUrl);
            }
        }).catch(() => {
            const shareUrl = `https://t.me/share/url?url=&text=${encodeURIComponent(text + "\n\n" + url)}`;
            if (tg && tg.openTelegramLink) {
                tg.openTelegramLink(shareUrl);
            } else {
                showToast("Unable to share or copy link", "error");
            }
        });
    };

    if (navigator.share) {
        navigator.share({
            title: 'Dice Arena Match',
            text: text + "\n\n" + url
        }).catch((err) => {
            console.log("Share failed or cancelled:", err);
            // Fallback if system share is supported but fails or is cancelled
            fallbackCopyAndShare();
        });
    } else {
        fallbackCopyAndShare();
    }
}

function openGameplayScreen(roomId, isOwner, bet, result = null) {
    currentRoomId = roomId;
    currentRoomBet = bet;
    weAreRoomOwner = isOwner;
    
    // Сбрасываем старый опрос, если он был активен
    if (roomPollInterval) {
        clearInterval(roomPollInterval);
        roomPollInterval = null;
    }
    
    if (elements.gameRoomId) elements.gameRoomId.textContent = `Room ID: ${roomId}`;
    
    // Обновляем общую сумму банка на кону (Total Pot)
    const potElement = document.getElementById('game-pot-amount');
    if (potElement) {
        const potAmount = bet * 2;
        potElement.textContent = `${potAmount.toLocaleString()} 🪙`;
    }
    
    if (elements.gameplayScreen) elements.gameplayScreen.classList.remove('hidden');
    if (elements.matchResults) elements.matchResults.classList.add('hidden');
    if (elements.gameStatusText) elements.gameStatusText.classList.remove('hidden');
    
    // Сбрасываем текст VS-баджа и видимость SVG кольца
    if (elements.vsBadgeText) {
        elements.vsBadgeText.textContent = "VS";
        elements.vsBadgeText.className = "vs-badge";
    }
    const ringSvg = document.getElementById('vs-ring-svg');

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
        if (ringSvg) ringSvg.style.opacity = '1';
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
        if (ringSvg) ringSvg.style.opacity = '0';
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
    
    // Гарантируем, что обертка VS-кольца видима (в CSS по умолчанию opacity: 0)
    const vsWrapper = document.getElementById('vs-ring-wrapper');
    if (vsWrapper) vsWrapper.style.opacity = '1';
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
    try {
        if (!result) {
            console.error("No game result provided to showGameResults");
            return;
        }
        
        // Принудительно обновляем профиль для получения свежего баланса после матча
        fetchUserProfile();
        
        if (elements.matchResults) elements.matchResults.classList.remove('hidden');
        const isWinner = Number(result.winner_id) === Number(currentUser.id);
        
        // Определяем победителя и показываем корону над нужным аватаром
        const crownOwner = document.getElementById('crown-owner');
        const crownOpponent = document.getElementById('crown-opponent');
        if (crownOwner) crownOwner.classList.add('hidden');
        if (crownOpponent) crownOpponent.classList.add('hidden');
        
        if (result.is_draw) {
            if (elements.matchResults) elements.matchResults.className = "match-results-box draw";
            if (elements.resultTitle) elements.resultTitle.textContent = "🤝 Tie roll!";
            if (elements.resultSubtitle) elements.resultSubtitle.textContent = "All bets returned.";
            
            if (elements.vsBadgeText) {
                elements.vsBadgeText.textContent = "🤷";
                elements.vsBadgeText.className = "vs-badge draw-arrows";
            }
        } else {
            // Защита от undefined в rolls
            const rolls = result.rolls || { owner: 1, opponent: 1 };
            const ownerWon = Number(rolls.owner) < Number(rolls.opponent);
            
            if (ownerWon) {
                if (crownOwner) crownOwner.classList.remove('hidden');
            } else {
                if (crownOpponent) crownOpponent.classList.remove('hidden');
            }

            // Спавним вылетающие монетки в сторону победителя
            const spawnCoins = (toLeft) => {
                const container = document.getElementById('vs-ring-wrapper');
                if (!container) return;
                
                for (let i = 0; i < 5; i++) {
                    setTimeout(() => {
                        const coin = document.createElement('div');
                        coin.className = `flying-coin ${toLeft ? 'coin-to-left' : 'coin-to-right'}`;
                        coin.textContent = "🪙";
                        
                        const randomY = (Math.random() * 20 - 10);
                        coin.style.top = `calc(50% - 12px + ${randomY}px)`;
                        coin.style.left = `calc(50% - 12px)`;
                        
                        container.appendChild(coin);
                        setTimeout(() => coin.remove(), 1000);
                    }, i * 80);
                }
            };

            if (elements.vsBadgeText) {
                // Если мы победили — палец зеленый, если проиграли — красный, независимо от роли
                elements.vsBadgeText.className = isWinner ? "vs-badge win-arrows" : "vs-badge lose-arrows";
                if (ownerWon) {
                    elements.vsBadgeText.textContent = "👈";
                    spawnCoins(true);
                } else {
                    elements.vsBadgeText.textContent = "👉";
                    spawnCoins(false);
                }
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
    } catch (err) {
        showToast("Error rendering results: " + err.message, "error");
        console.error("Error in showGameResults:", err);
    }
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
        // Скрываем только SVG кольцо, оставляя badge и монетки видимыми
        const ringSvg = document.getElementById('vs-ring-svg');
        if (ringSvg) ringSvg.style.opacity = '0';
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
    const ringSvg = document.getElementById('vs-ring-svg');
    if (ringSvg) ringSvg.style.opacity = '1';
    
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
    // elements.inputBet.focus(); // Убрано автооткрытие клавиатуры со старта
    updateRoomLimitDisplay();
};

// Предотвращаем потерю фокуса с поля ввода (и скрытие клавиатуры на смартфонах) при тапах вне интерактивных элементов
if (elements.createRoomModal) {
    const preventFocusLoss = (e) => {
        // Если тап на пресетную кнопку ставки и поле ввода уже в фокусе (клавиатура открыта)
        if (e.target.closest('.btn-preset')) {
            if (document.activeElement === elements.inputBet) {
                e.preventDefault(); // Предотвращаем потерю фокуса и скрытие клавиатуры
                
                // Вручную применяем пресет
                const btn = e.target.closest('.btn-preset');
                elements.presetBets.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                elements.inputBet.value = btn.dataset.val;
            }
            return;
        }

        // Если тап пришелся на поле ввода или другие интерактивные кнопки, разрешаем стандартное поведение
        if (e.target === elements.inputBet || 
            e.target.closest('#btn-confirm-create') || 
            e.target.closest('#btn-close-create-modal') ||
            e.target.closest('.custom-checkbox-container')) {
            return;
        }
        
        // Предотвращаем уход фокуса при тапах на пустое место модалки
        if (document.activeElement === elements.inputBet) {
            e.preventDefault();
        }
    };
    elements.createRoomModal.addEventListener('mousedown', preventFocusLoss);
    elements.createRoomModal.addEventListener('touchstart', preventFocusLoss, { passive: false });
}

async function updateRoomLimitDisplay() {
    const limitInfoEl = document.getElementById('room-limit-info');
    const confirmBtn = document.getElementById('btn-confirm-create');
    if (!limitInfoEl) return;
    
    limitInfoEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking limit...`;
    
    try {
        const res = await fetch(`${API_BASE_URL}/api/rooms/my`, { headers: getHeaders() });
        const data = await res.json();
        
        if (res.ok) {
            const count = data.length;
            const left = 20 - count;
            
            if (count >= 20) {
                limitInfoEl.innerHTML = `<span style="color: #ff3b30; font-weight: 700;">${count} / 20 (Limit Exceeded)</span>`;
                if (confirmBtn) {
                    confirmBtn.disabled = true;
                    confirmBtn.textContent = "Limit Exceeded (20/20)";
                    confirmBtn.style.opacity = "0.5";
                }
            } else {
                limitInfoEl.innerHTML = `<span style="color: var(--neon-green); font-weight: 700;">${count} / 20</span> (Available: <strong>${left}</strong>)`;
                if (confirmBtn) {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = "Confirm Bet";
                    confirmBtn.style.opacity = "1";
                }
            }
        } else {
            limitInfoEl.textContent = "Error checking limit";
        }
    } catch (e) {
        limitInfoEl.textContent = "Error checking limit";
    }
}

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

if (elements.btnSystemShare) {
    elements.btnSystemShare.onclick = () => {
        systemShare();
    };
}

if (elements.btnTgInvite) {
    elements.btnTgInvite.onclick = () => {
        tgInvite();
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
        syncLobbyData();
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
        syncLobbyData();
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

// Эффект красивого блика (shimmer) для кнопки Daily Bonus (однократный запуск при старте)
function triggerClaimBonusShimmer() {
    if (elements.btnClaimGift && currentUser && !currentUser.bonus_cooldown) {
        elements.btnClaimGift.classList.add('shimmer-glow');
        setTimeout(() => {
            if (elements.btnClaimGift) {
                elements.btnClaimGift.classList.remove('shimmer-glow');
            }
        }, 1400);
    }
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
syncLobbyData();
connectLobbySocket();
if (elements.btnClaimGift) {
    setTimeout(() => {
        triggerClaimBonusShimmer();
    }, 3000);
}

// Автоматический вход в комнату дуэли по ссылке (Deep Linking)
if (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) {
    const startParam = tg.initDataUnsafe.start_param;
    if (startParam.startsWith('join_')) {
        const roomId = startParam.split('join_')[1];
        setTimeout(async () => {
            console.log("Deep-link join: fetching room info for", roomId);
            try {
                const res = await fetch(`${API_BASE_URL}/api/rooms`, { headers: getHeaders() });
                const rooms = await res.json();
                const roomInfo = Array.isArray(rooms) ? rooms.find(r => r.id === roomId) : null;
                if (roomInfo) {
                    // Полностью тот же флоу что при нажатии кнопки Join Bet
                    confirmJoinRoom(roomId, roomInfo.owner_username || 'Opponent', roomInfo.bet);
                } else {
                    // Комната приватная или не найдена в публичном списке — показываем базовое подтверждение
                    confirmJoinRoom(roomId, 'Opponent', '—');
                }
            } catch (e) {
                console.error("Deep-link join error:", e);
                showToast("Failed to load room info", "error");
            }
        }, 1200);
    }
}


// Фоновое обновление лобби раз в 10 секунд (синхронизация)
setInterval(async () => {
    if (document.hidden) return; // Пропускаем обновление, если приложение свёрнуто
    // Делаем фоновые запросы только когда игрок находится на экране лобби (экран игры скрыт)
    if (elements.gameplayScreen && elements.gameplayScreen.classList.contains('hidden')) {
        await syncLobbyData();
    }
}, 10000);



// Клик по аватарке — открыть/закрыть уведомления
if (elements.userAvatarWrapper) {
    elements.userAvatarWrapper.onclick = () => {
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

// =============================================
// LEADERBOARD MODULE
// =============================================

let lbCountdownTimer = null;
let leaderboardData = null; // cached leaderboard from last fetch

// League metadata
const LEAGUES = {
    gold:   { label: 'Golden League',   cls: 'league-gold',   crown: '👑', crownCls: 'crown-gold'   },
    silver: { label: 'Silver League',   cls: 'league-silver', crown: '🥈', crownCls: 'crown-silver' },
    bronze: { label: 'Bronze League',   cls: 'league-bronze', crown: '🥉', crownCls: 'crown-bronze' },
    rookie: { label: 'Rookie League',   cls: 'league-rookie', crown: '⬜', crownCls: 'crown-rookie' },
};

function getLeagueForRank(rank) {
    if (rank === 1) return 'gold';
    if (rank === 2) return 'silver';
    if (rank === 3) return 'bronze';
    return 'rookie';
}

// Prize per rank
const PRIZES = { 1: '10,000', 2: '5,000', 3: '2,000' };

/**
 * Fetch leaderboard data from backend
 */
async function fetchLeaderboard() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/leaderboard?t=${Date.now()}`, { headers: getHeaders() });
        if (!res.ok) throw new Error('leaderboard fetch failed');
        leaderboardData = await res.json();
        return leaderboardData;
    } catch (e) {
        console.error('Leaderboard fetch error:', e);
        return null;
    }
}

/**
 * Open leaderboard screen
 */
async function openLeaderboard() {
    const screen = document.getElementById('leaderboard-screen');
    if (!screen) return;

    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');

    screen.classList.remove('hidden');

    // Show skeleton
    const podium = document.getElementById('lb-podium');
    const list   = document.getElementById('lb-list');
    if (podium) podium.innerHTML = '<div class="lb-empty"><i class="fa-solid fa-spinner fa-spin"></i>Loading...</div>';
    if (list)   list.innerHTML   = '';

    // Start countdown with fallback (midnight CET) while data loads
    startLbCountdown(null);

    // Fetch and render
    const data = await fetchLeaderboard();
    if (data) {
        renderLeaderboard(data);
        // Restart countdown with accurate next_reset_ts from server
        if (data.next_reset_ts) {
            startLbCountdown(data.next_reset_ts);
        }
    }
}

/**
 * Close leaderboard screen
 */
function closeLeaderboard() {
    const screen = document.getElementById('leaderboard-screen');
    if (screen) screen.classList.add('hidden');
    if (lbCountdownTimer) { clearInterval(lbCountdownTimer); lbCountdownTimer = null; }
}

/**
 * Countdown to next reset.
 * @param {number|null} targetTs  - Unix timestamp (seconds) of next reset.
 *                                   If null/undefined, falls back to next midnight CET.
 */
function startLbCountdown(targetTs) {
    if (lbCountdownTimer) clearInterval(lbCountdownTimer);

    function getTargetMs() {
        if (targetTs) {
            return targetTs * 1000; // convert seconds → ms
        }
        // fallback: next midnight CET (UTC+1, fixed)
        const now = new Date();
        const CET_OFFSET_MS = 1 * 60 * 60 * 1000;
        const nowCET = new Date(now.getTime() + CET_OFFSET_MS - now.getTimezoneOffset() * 60000);
        const midnight = new Date(nowCET);
        midnight.setHours(24, 0, 0, 0);
        return midnight.getTime() + now.getTimezoneOffset() * 60000 - CET_OFFSET_MS;
    }

    function update() {
        const diffMs = getTargetMs() - Date.now();
        const el = document.getElementById('lb-countdown');
        if (!el) return;
        if (diffMs <= 0) {
            el.textContent = '00:00:00';
            return;
        }
        const h = Math.floor(diffMs / 3600000);
        const m = Math.floor((diffMs % 3600000) / 60000);
        const s = Math.floor((diffMs % 60000) / 1000);
        const pad = n => String(n).padStart(2, '0');
        el.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
    }

    update();
    lbCountdownTimer = setInterval(update, 1000);
}

/**
 * Render leaderboard
 */
function renderLeaderboard(data) {
    const entries   = data.entries || [];   // [{ rank, user_id, username, first_name, won_today }]
    const myEntry   = data.my_entry;        // { rank, won_today } or null
    const myId      = currentUser.id;

    // ---- Podium (top 3) ----
    const podiumEl = document.getElementById('lb-podium');
    if (podiumEl) {
        const top3 = entries.filter(e => e.rank <= 3);
        if (top3.length === 0) {
            podiumEl.innerHTML = `<div class="lb-empty"><i class="fa-solid fa-trophy"></i>No games played today yet</div>`;
        } else {
            podiumEl.innerHTML = top3.map(e => {
                const league = getLeagueForRank(e.rank);
                const meta   = LEAGUES[league];
                const isMe   = e.user_id === myId;
                const rawName = e.username ? `@${e.username}` : (e.first_name || 'Player');
                const maskedName = e.username ? `@${maskUsername(e.username)}` : maskUsername(e.first_name || 'Player');
                const name   = isMe ? rawName : maskedName;
                const initial = (e.first_name || e.username || 'P').charAt(0).toUpperCase();
                const avCls  = ['gold-av','silver-av','bronze-av'][e.rank - 1];
                const prize  = PRIZES[e.rank] ? `${PRIZES[e.rank]} 🎁` : '';

                let rankIndicatorHtml = '';
                let avatarBadgeHtml = '';

                if (e.rank === 1) {
                    rankIndicatorHtml = `<span class="lb-podium-crown">👑</span>`;
                } else if (e.rank === 2) {
                    avatarBadgeHtml = `<span class="lb-podium-medal">🥈</span>`;
                } else if (e.rank === 3) {
                    avatarBadgeHtml = `<span class="lb-podium-medal">🥉</span>`;
                }

                return `
                <div class="lb-podium-card place-${e.rank}${isMe ? ' is-me' : ''}">
                    <span class="lb-podium-league ${meta.cls}">${meta.label}</span>
                    <div class="lb-podium-avatar-wrapper">
                        ${rankIndicatorHtml}
                        <div class="lb-podium-avatar ${avCls}">
                            ${initial}
                            ${avatarBadgeHtml}
                        </div>
                    </div>
                    <span class="lb-podium-name">${isMe ? '⭐ You' : name}</span>
                    <span class="lb-podium-score">${e.won_today.toLocaleString()} 🪙</span>
                    ${prize ? `<span class="lb-podium-prize">${prize}</span>` : ''}
                </div>`;
            }).join('');
        }
    }

    // ---- List (4-10) ----
    const listEl = document.getElementById('lb-list');
    if (listEl) {
        const rest = entries.filter(e => e.rank > 3);
        if (rest.length === 0) {
            listEl.innerHTML = '';
        } else {
            listEl.innerHTML = rest.map(e => {
                const league = getLeagueForRank(e.rank);
                const meta   = LEAGUES[league];
                const isMe   = e.user_id === myId;
                const rawName = e.username ? `@${e.username}` : (e.first_name || 'Player');
                const maskedName = e.username ? `@${maskUsername(e.username)}` : maskUsername(e.first_name || 'Player');
                const name   = isMe ? rawName : maskedName;
                const initial = (e.first_name || e.username || 'P').charAt(0).toUpperCase();

                return `
                <div class="lb-list-item${isMe ? ' is-me' : ''}">
                    <span class="lb-list-rank">${e.rank}</span>
                    <div class="lb-list-avatar">${initial}</div>
                    <div class="lb-list-info">
                        <div class="lb-list-name">${isMe ? '⭐ ' + name : name}</div>
                        <div class="lb-list-league">${meta.label}</div>
                    </div>
                    <span class="lb-list-score">${e.won_today.toLocaleString()} 🪙</span>
                </div>`;
            }).join('');
        }
    }

    // ---- My position (if not in top 10) ----
    const myPosEl = document.getElementById('lb-my-position');
    if (myPosEl) {
        if (myEntry && myEntry.rank > 10) {
            const league = getLeagueForRank(myEntry.rank);
            const meta   = LEAGUES[league];
            myPosEl.classList.remove('hidden');
            myPosEl.innerHTML = `
                <span class="lb-my-rank">#${myEntry.rank}</span>
                <div class="lb-my-info">
                    <div class="lb-my-name">⭐ You</div>
                    <div class="lb-my-sub">${meta.label}</div>
                </div>
                <span class="lb-my-score">${(myEntry.won_today || 0).toLocaleString()} 🪙</span>
            `;
        } else {
            myPosEl.classList.add('hidden');
        }
    }
}

/**
 * Update league badge in profile header
 */
function updateLeagueBadge(leagueKey) {
    const badge = document.getElementById('league-badge');
    if (!badge) return;
    
    // Default to 'rookie' if not in Gold/Silver/Bronze/Rookie
    let key = leagueKey;
    if (!key || key === 'none' || !LEAGUES[key]) {
        key = 'rookie';
    }
    
    const meta = LEAGUES[key];
    badge.className = `league-badge ${meta.cls}`;
    badge.innerHTML = `<i class="fa-solid fa-crown league-badge-crown"></i> ${meta.label}`;
}

/**
 * Fetch current user's league and update badge
 */
async function fetchAndUpdateLeague() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/leaderboard/my-league?t=${Date.now()}`, { headers: getHeaders() });
        if (!res.ok) {
            updateLeagueBadge('rookie');
            return;
        }
        const data = await res.json();
        updateLeagueBadge(data.league || 'rookie');
    } catch (e) {
        updateLeagueBadge('rookie');
    }
}

// Initialize leaderboard on app load is now part of syncLobbyData
async function syncLobbyData() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/lobby/sync?t=${Date.now()}`, { headers: getHeaders() });
        if (!res.ok) {
            // Fallback if sync fails
            await Promise.all([
                fetchUserProfile(),
                fetchActiveRooms(),
                fetchNotifications(),
                fetchAndUpdateLeague()
            ]);
            return;
        }
        const data = await res.json();
        
        // 1. Profile
        if (data.profile) {
            currentUser = data.profile;
            if (currentUser.bot_username) {
                BOT_USERNAME = currentUser.bot_username;
            }
            elements.usernameDisplay.textContent = currentUser.username 
                ? `@${currentUser.username}` 
                : currentUser.first_name;
            elements.balanceDisplay.textContent = `${currentUser.balance.toLocaleString()} 🪙`;
            
            const matchBalEl = document.getElementById('match-new-balance');
            if (matchBalEl) {
                matchBalEl.textContent = `${currentUser.balance.toLocaleString()} 🪙`;
            }
            
            const userAvatarElement = document.getElementById('user-avatar');
            if (userAvatarElement) {
                if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.photo_url) {
                    userAvatarElement.innerHTML = `<img src="${tg.initDataUnsafe.user.photo_url}" alt="Avatar" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                } else {
                    const name = currentUser.first_name || currentUser.username || "P";
                    userAvatarElement.textContent = name.charAt(0).toUpperCase();
                    userAvatarElement.style.fontSize = "20px";
                    userAvatarElement.style.fontWeight = "800";
                    userAvatarElement.style.color = "var(--black)";
                }
            }
        }
        
        // 2. Rooms
        if (data.rooms) {
            activeRooms = data.rooms;
            renderRooms(activeRooms);
        }
        
        // 3. Notifications
        if (data.notifications) {
            const notifData = data.notifications;
            if (elements.notifBell) {
                const hasNotifications = notifData.notifications && notifData.notifications.length > 0;
                if (notifData.unread > 0 && hasNotifications) {
                    elements.notifBell.classList.remove('hidden');
                } else {
                    elements.notifBell.classList.add('hidden');
                }
            }
            renderNotifications(notifData.notifications);
        }
        
        // 4. League
        if (data.league) {
            updateLeagueBadge(data.league || 'rookie');
        }
    } catch (e) {
        console.error("Lobby sync failed, falling back", e);
        try {
            await Promise.all([
                fetchUserProfile(),
                fetchActiveRooms(),
                fetchNotifications(),
                fetchAndUpdateLeague()
            ]);
        } catch (err) {
            console.error("Fallback failed", err);
        }
    }
}

// =============================================
// WELCOME SCREEN + TUTORIAL MODULE
// =============================================

const WELCOME_SEEN_KEY = 'dice_arena_welcome_seen';

// ---- Tutorial Steps Definition ----
// Each step: { icon, title, desc, targetId, position }
// targetId: CSS selector to highlight (null = no highlight)
// position: 'top' | 'bottom' | 'center' (where to place tooltip relative to target)
const TUTORIAL_STEPS = [
    {
        icon: '⚔️',
        title: 'Choose your fighter',
        desc: 'This is the list of active game rooms. Tap the button to double the selected bet.',
        targetId: '.room-card-item',
        position: 'bottom'
    },
    {
        icon: '⚔️',
        title: 'Choose your fighter',
        desc: 'This is the bet amount you need to double.',
        targetId: '.room-bet-amount',
        position: 'bottom',
        blocked: true
    },
    {
        icon: '🤔',
        title: 'How it works',
        desc: 'During the match, dice rolls are generated directly inside your chat with our bot on Telegram’s side, guaranteeing fair and honest results.',
        targetId: null,
        position: 'center',
        blocked: true
    },
    {
        icon: '🔒',
        title: 'Provably Fair Rolls',
        desc: 'Every roll uses **Telegram\'s native animated dice** — sent via the bot in a private chat. Telegram\'s servers generate the result, making it impossible for anyone (including us) to cheat.',
        targetId: null,
        position: 'center',
        blocked: true
    },
    {
        icon: '🏠',
        title: 'Active Matches Lobby',
        desc: 'This is the live lobby. It shows all open game rooms waiting for an opponent. The list updates in real time via WebSocket — you\'ll always see the freshest rooms.',
        targetId: '.lobby-panel',
        position: 'bottom',
        blocked: true
    },
    {
        icon: '⚡',
        title: 'Join a Room',
        desc: 'Tap here to **accept an existing bet**.',
        targetId: '.btn-join',
        position: 'bottom',
        blocked: true
    },
    {
        icon: '🔍',
        title: 'Filters & Sorting',
        desc: 'Here you can find your perfect match quickly.',
        targetId: '.lobby-filter-bar',
        position: 'bottom'
    },
    {
        icon: '➕',
        title: 'Create Your Own Bet',
        desc: 'Play with your friends or against strangers.',
        targetId: '#btn-create-room',
        position: 'bottom'
    },
    {
        icon: '🎁',
        title: 'Daily Bonus',
        desc: 'You can claim **1,000 free coins** every 6 hours.',
        targetId: '#btn-claim-gift',
        position: 'bottom',
        blocked: true
    },
    {
        icon: '🔔',
        title: 'Match History',
        desc: 'Tap your **avatar** to toggle the notification history drawer. You can check the logs of your previous games, wins, and claim bonuses here.',
        targetId: '#user-avatar-wrapper',
        position: 'bottom',
        blocked: true
    },
    {
        icon: '👑',
        title: 'King of the Hill',
        desc: 'The top 3 winners of the day get extra prizes!',
        targetId: '#league-badge',
        position: 'bottom',
        blocked: true
    }
];

function getActiveTutorialSteps() {
    return TUTORIAL_STEPS.filter(step => !step.blocked);
}

let tutorialStep = 0;
let spotlightEl = null;

// ---- Confetti Engine ----
function startConfetti(canvas) {
    const ctx = canvas.getContext('2d');
    
    // Support retina displays and set physical pixels correctly
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const COLORS = ['#00ff87', '#05c46b', '#ffd700', '#ffffff', '#ff6b6b', '#60dfff', '#ff9f43'];
    const pieces = [];
    // Reduced particle count from 120 to 60 for better performance on mobile devices
    const TOTAL  = 60;

    for (let i = 0; i < TOTAL; i++) {
        const fromLeft = i < TOTAL / 2;
        const isDice = Math.random() < 0.15; 
        pieces.push({
            x: fromLeft ? -10 : rect.width + 10,
            y: Math.random() * rect.height * 0.5,
            vx: fromLeft ? (2 + Math.random() * 4) : -(2 + Math.random() * 4),
            vy: -3 - Math.random() * 4,
            gravity: 0.15 + Math.random() * 0.1,
            size: isDice ? (14 + Math.random() * 6) : (5 + Math.random() * 6),
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            rotation: Math.random() * 360,
            rotSpeed: (Math.random() - 0.5) * 6,
            shape: isDice ? 'dice' : (Math.random() > 0.5 ? 'rect' : 'circle'),
            diceChar: isDice ? '🎲' : '',
            alpha: 1
        });
    }

    let animId;
    function draw() {
        ctx.clearRect(0, 0, rect.width, rect.height);
        let alive = false;
        for (const p of pieces) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += p.gravity;
            p.vx *= 0.98;
            p.rotation += p.rotSpeed;
            if (p.y > rect.height) { p.alpha -= 0.05; }
            if (p.alpha <= 0) continue;
            alive = true;
            ctx.save();
            ctx.globalAlpha = p.alpha;
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation * Math.PI / 180);
            
            if (p.shape === 'dice') {
                ctx.font = `${p.size}px Outfit, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                // Removed shadowBlur to prevent GPU lag / micro-stutters on mobile WebView
                ctx.fillStyle = '#ffffff';
                ctx.fillText(p.diceChar, 0, 0);
            } else {
                ctx.fillStyle = p.color;
                if (p.shape === 'rect') {
                    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
                } else {
                    ctx.beginPath();
                    ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.restore();
        }
        if (alive) {
            animId = requestAnimationFrame(draw);
        }
    }
    draw();
    return () => cancelAnimationFrame(animId);
}

// ---- Welcome Modal Logic ----
function shouldShowWelcome() {
    if (currentUser) {
        return !currentUser.welcome_seen;
    }
    try {
        return !localStorage.getItem(WELCOME_SEEN_KEY);
    } catch(e) {
        return false;
    }
}

function markWelcomeSeen() {
    try { 
        localStorage.setItem(WELCOME_SEEN_KEY, '1'); 
    } catch(e) {}

    if (currentUser) {
        currentUser.welcome_seen = true;
    }

    // Call API to mark welcome seen in DB
    fetch(`${API_BASE_URL}/api/user/welcome-seen`, {
        method: 'POST',
        headers: getHeaders()
    }).catch(err => console.error("Failed to mark welcome seen in DB:", err));
}

function showWelcomeModal() {
    const modal  = document.getElementById('welcome-modal');
    const canvas = document.getElementById('confetti-canvas');
    const loader = document.getElementById('welcome-loader');
    const wrapper = modal ? modal.querySelector('.welcome-card-wrapper') : null;
    if (!modal) return;

    modal.classList.remove('hidden');

    // Keep card layout hidden and show loader spinner first to reduce entrance thrashing
    if (wrapper) wrapper.classList.remove('loaded');
    if (loader) loader.style.display = 'block';

    let canDismiss = false;

    // Wait a brief delay (600ms) for main page rendering & websockets to settle
    setTimeout(() => {
        // Haptic Feedback
        if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');

        // Fade out loader spinner
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => { loader.style.display = 'none'; }, 300);
        }

        // Show card and trigger confetti
        if (wrapper) wrapper.classList.add('loaded');

        if (canvas) {
            stopConfetti = startConfetti(canvas);
            // Stop after 5 seconds
            setTimeout(() => { if (stopConfetti) stopConfetti(); }, 5000);
        }

        // Only allow dismissing after the card has fully transitioned in
        setTimeout(() => {
            canDismiss = true;
        }, 500);
    }, 600);

    let stopConfetti;

    // Buttons
    const btnStart = document.getElementById('btn-start-tutorial');
    const btnSkip  = document.getElementById('btn-skip-tutorial');
    const btnClose = document.getElementById('btn-close-welcome-modal');
    const welcomeCard = modal.querySelector('.welcome-card');

    const handleSkip = () => {
        if (!canDismiss) return;
        if (stopConfetti) stopConfetti();
        closeWelcomeModal();
        markWelcomeSeen();
        showHelpIndicatorHint();
    };

    if (btnStart) {
        btnStart.onclick = (e) => {
            e.stopPropagation(); // prevent backdrop click from triggering skip
            if (!canDismiss) return;
            if (stopConfetti) stopConfetti();
            closeWelcomeModal();
            markWelcomeSeen();
            startTutorial();
        };
    }
    if (btnSkip) {
        btnSkip.onclick = (e) => {
            e.stopPropagation(); // prevent duplicate calls
            handleSkip();
        };
    }
    if (btnClose) {
        btnClose.onclick = (e) => {
            e.stopPropagation();
            handleSkip();
        };
    }

    // Dismiss welcome modal when clicking anywhere outside the card
    modal.onclick = (e) => {
        if (welcomeCard && !welcomeCard.contains(e.target)) {
            handleSkip();
        }
    };
}

function closeWelcomeModal() {
    const modal = document.getElementById('welcome-modal');
    if (modal) {
        modal.style.animation = 'welcomeFadeIn 0.3s ease reverse forwards';
        setTimeout(() => { modal.classList.add('hidden'); modal.style.animation = ''; }, 300);
    }
}

// Hint popup that targets the [?] button after skipping tutorial
function showHelpIndicatorHint() {
    const overlay = document.getElementById('tutorial-overlay');
    const tooltip = document.getElementById('tutorial-tooltip');
    const helpBtn = document.getElementById('btn-tutorial-help');
    if (!overlay || !tooltip || !helpBtn) return;

    // Reset overlay elements
    const badgeEl    = document.getElementById('tutorial-step-badge');
    const iconEl     = document.getElementById('tutorial-icon');
    const titleEl    = document.getElementById('tutorial-title');
    const descEl     = document.getElementById('tutorial-desc');
    const nextBtnEl  = document.getElementById('tutorial-btn-next');
    const exitBtnEl  = document.getElementById('tutorial-btn-exit');

    overlay.classList.remove('hidden');

    if (!spotlightEl) {
        spotlightEl = document.createElement('div');
        spotlightEl.className = 'tutorial-spotlight';
        overlay.appendChild(spotlightEl);
    }

    if (badgeEl) badgeEl.textContent = 'TIP';
    if (iconEl) iconEl.textContent = '👍';
    if (titleEl) titleEl.textContent = 'Here if you need it!';
    if (descEl) descEl.textContent = 'You can always take the quick tour later by clicking this button.';

    if (exitBtnEl) exitBtnEl.style.display = 'none';
    if (nextBtnEl) {
        nextBtnEl.innerHTML = 'Got it! <i class="fa-solid fa-check"></i>';
        nextBtnEl.onclick = closeTutorial;
    }

    updateSpotlightAndTooltip(helpBtn, 'bottom', tooltip, overlay);

    // Override the generic resize handler so scroll/resize always re-targets [?] button
    // (the default handler uses tutorialStep index which still points to the last tutorial step)
    if (window._tutorialResizeHandler) {
        window.removeEventListener('resize', window._tutorialResizeHandler);
        window.removeEventListener('scroll', window._tutorialResizeHandler);
    }
    window._tutorialResizeHandler = () => {
        updateSpotlightAndTooltipPositionOnly(helpBtn, 'bottom', tooltip, overlay);
    };
    window.addEventListener('resize', window._tutorialResizeHandler, { passive: true });
    window.addEventListener('scroll', window._tutorialResizeHandler, { passive: true });
}

// ---- Tutorial Logic ----
function startTutorial() {
    markWelcomeSeen();
    tutorialStep = 0;
    const overlay = document.getElementById('tutorial-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');

    // Add click handler to nudge Next button if user clicks outside the tooltip
    overlay.onclick = (e) => {
        const tooltip = document.getElementById('tutorial-tooltip');
        if (tooltip && !tooltip.contains(e.target)) {
            const nextBtn = document.getElementById('tutorial-btn-next');
            if (nextBtn) {
                nextBtn.classList.remove('tutorial-btn-nudge');
                void nextBtn.offsetWidth; // Trigger reflow to restart CSS animation
                nextBtn.classList.add('tutorial-btn-nudge');
                
                // Add Telegram haptic feedback if available
                if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
                    window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
                }
            }
        }
    };

    // Create spotlight element
    if (!spotlightEl) {
        spotlightEl = document.createElement('div');
        spotlightEl.className = 'tutorial-spotlight';
        overlay.appendChild(spotlightEl);
    }

    showTutorialStep(tutorialStep);
}

function showTutorialStep(stepIdx) {
    const steps   = getActiveTutorialSteps();
    const overlay = document.getElementById('tutorial-overlay');
    const tooltip = document.getElementById('tutorial-tooltip');

    if (!overlay || !tooltip || stepIdx >= steps.length) {
        closeTutorial();
        return;
    }

    const step = steps[stepIdx];

    // Update tooltip content
    const badgeEl    = document.getElementById('tutorial-step-badge');
    const iconEl     = document.getElementById('tutorial-icon');
    const titleEl    = document.getElementById('tutorial-title');
    const descEl     = document.getElementById('tutorial-desc');
    const nextBtnEl  = document.getElementById('tutorial-btn-next');
    const exitBtnEl  = document.getElementById('tutorial-btn-exit');

    if (badgeEl)   badgeEl.textContent  = `Step ${stepIdx + 1} / ${steps.length}`;
    if (iconEl)    iconEl.textContent   = step.icon;
    if (titleEl)   titleEl.textContent  = step.title;
    if (descEl)    descEl.innerHTML     = step.desc.replace(/\n\n/g, '<br><br>').replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--white)">$1</strong>');

    // Progress bar
    let progressBar = tooltip.querySelector('.tutorial-progress-bar');
    if (!progressBar) {
        progressBar = document.createElement('div');
        progressBar.className = 'tutorial-progress-bar';
        progressBar.innerHTML = '<div class="tutorial-progress-fill"></div>';
        tooltip.appendChild(progressBar);
    }
    const fill = progressBar.querySelector('.tutorial-progress-fill');
    if (fill) fill.style.width = `${((stepIdx + 1) / steps.length) * 100}%`;

    // Button labels
    const isLast = stepIdx === steps.length - 1;
    if (nextBtnEl) {
        if (isLast) {
            nextBtnEl.innerHTML = '🎮 Start Playing! <i class="fa-solid fa-play"></i>';
        } else {
            nextBtnEl.innerHTML = 'Next <i class="fa-solid fa-arrow-right"></i>';
        }
        nextBtnEl.onclick = () => {
            if (isLast) {
                closeTutorial();
            } else {
                tutorialStep++;
                showTutorialStep(tutorialStep);
            }
        };
    }
    if (exitBtnEl) {
        if (isLast) {
            exitBtnEl.style.display = 'none';
        } else {
            exitBtnEl.style.display = '';
        }
        exitBtnEl.onclick = closeTutorial;
    }

    // Spotlight target
    const targetSel = step.targetId;
    let targetEl = targetSel ? document.querySelector(targetSel) : null;

    // Position spotlight and tooltip
    updateSpotlightAndTooltip(targetEl, step.position, tooltip, overlay);
}

function updateSpotlightAndTooltip(targetEl, position, tooltip, overlay) {
    const PADDING = 8;
    
    // Always start by removing the centered class to reset layout styles
    tooltip.classList.remove('centered');

    if (targetEl && spotlightEl) {
        const rect = targetEl.getBoundingClientRect();
        
        // Highlight the entire vertical space from top (0px) to the very bottom of the screen (window.innerHeight)
        const isLobby = targetEl.classList.contains('lobby-panel');
        const spotlightTop = isLobby ? 0 : (rect.top - PADDING);
        const spotlightHeight = isLobby ? window.innerHeight : (rect.height + PADDING * 2);

        spotlightEl.style.display = 'block';
        spotlightEl.style.top    = `${spotlightTop}px`;
        spotlightEl.style.left   = `${rect.left   - PADDING}px`;
        spotlightEl.style.width  = `${rect.width  + PADDING * 2}px`;
        spotlightEl.style.height = `${spotlightHeight}px`;

        // Dark backdrop with rectangular hole
        const backdrop = overlay.querySelector('.tutorial-backdrop');
        if (backdrop) {
            const t = spotlightTop;
            const l = rect.left   - PADDING;
            const b = isLobby ? window.innerHeight : (rect.bottom + PADDING);
            const r = rect.right  + PADDING;
            const W = window.innerWidth;
            const H = window.innerHeight;
            backdrop.style.clipPath =
                `polygon(0 0, ${W}px 0, ${W}px ${H}px, 0 ${H}px, 0 0, ` +
                `${l}px ${t}px, ${l}px ${b}px, ${r}px ${b}px, ${r}px ${t}px, ${l}px ${t}px)`;
        }

        // Position tooltip below or above target
        const tWidth = Math.min(330, window.innerWidth - 24);
        const tHeight = tooltip.offsetHeight || 160; // Fallback height if not rendered yet
        const spaceBelow = window.innerHeight - rect.bottom - PADDING - 16;
        const spaceAbove = rect.top - PADDING - 16;
        
        let tooltipTop;
        // If explicitly requested 'top', try to place above if space permits
        if (position === 'top' && spaceAbove >= tHeight) {
            tooltipTop = rect.top - PADDING - 12 - tHeight;
        } else if (position === 'bottom' || spaceBelow >= tHeight || spaceBelow > spaceAbove) {
            tooltipTop = rect.bottom + PADDING + 12;
        } else {
            tooltipTop = rect.top - PADDING - 12 - tHeight;
        }

        // Center tooltip horizontally relative to the target element's bounds
        let tooltipLeft = rect.left + (rect.width - tWidth) / 2;
        // Keep inside screen bounds
        tooltipLeft = Math.max(12, Math.min(tooltipLeft, window.innerWidth - tWidth - 12));
        tooltipTop  = Math.max(12, Math.min(tooltipTop, window.innerHeight - tooltip.offsetHeight - 12));

        tooltip.style.top       = `${tooltipTop}px`;
        tooltip.style.left      = `${tooltipLeft}px`;
        tooltip.style.transform = 'none';

        // Scroll element into view smoothly
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

    } else {
        // No target — center tooltip, hide spotlight
        if (spotlightEl) spotlightEl.style.display = 'none';

        const backdrop = overlay.querySelector('.tutorial-backdrop');
        if (backdrop) backdrop.style.clipPath = 'none';

        tooltip.classList.add('centered');
    }

    // Animate tooltip re-entry
    tooltip.style.animation = 'none';
    // Trigger reflow
    void tooltip.offsetWidth;
    if (targetEl && spotlightEl) {
        tooltip.style.animation = 'tooltipFadeIn 0.35s ease both';
    } else {
        tooltip.style.animation = 'tooltipFadeInCentered 0.35s ease both';
    }

    // Track scroll and resize dynamically to realign the spotlight on viewport changes
    if (!window._tutorialResizeHandler) {
        window._tutorialResizeHandler = () => {
            const steps = getActiveTutorialSteps();
            const currentStep = steps[tutorialStep];
            if (currentStep) {
                const target = currentStep.targetId ? document.querySelector(currentStep.targetId) : null;
                // Re-align silently without scrolling again or re-animating
                updateSpotlightAndTooltipPositionOnly(target, currentStep.position, tooltip, overlay);
            }
        };
        window.addEventListener('resize', window._tutorialResizeHandler, { passive: true });
        window.addEventListener('scroll', window._tutorialResizeHandler, { passive: true });
    }
}

// Quietly updates coordinates during viewport/scroll actions without scrollIntoView trigger or animations
function updateSpotlightAndTooltipPositionOnly(targetEl, position, tooltip, overlay) {
    const PADDING = 8;
    if (!targetEl || !spotlightEl) return;
    
    const rect = targetEl.getBoundingClientRect();
    const isLobby = targetEl.classList.contains('lobby-panel');
    const spotlightTop = isLobby ? 0 : (rect.top - PADDING);
    const spotlightHeight = isLobby ? window.innerHeight : (rect.height + PADDING * 2);

    spotlightEl.style.top    = `${spotlightTop}px`;
    spotlightEl.style.left   = `${rect.left   - PADDING}px`;
    spotlightEl.style.width  = `${rect.width  + PADDING * 2}px`;
    spotlightEl.style.height = `${spotlightHeight}px`;

    const backdrop = overlay.querySelector('.tutorial-backdrop');
    if (backdrop) {
        const t = spotlightTop;
        const l = rect.left   - PADDING;
        const b = isLobby ? window.innerHeight : (rect.bottom + PADDING);
        const r = rect.right  + PADDING;
        const W = window.innerWidth;
        const H = window.innerHeight;
        backdrop.style.clipPath =
            `polygon(0 0, ${W}px 0, ${W}px ${H}px, 0 ${H}px, 0 0, ` +
            `${l}px ${t}px, ${l}px ${b}px, ${r}px ${b}px, ${r}px ${t}px, ${l}px ${t}px)`;
    }

    const tWidth = Math.min(330, window.innerWidth - 24);
    const tHeight = tooltip.offsetHeight || 160;
    const spaceBelow = window.innerHeight - rect.bottom - PADDING - 16;
    const spaceAbove = rect.top - PADDING - 16;
    
    let tooltipTop;
    if (position === 'top' && spaceAbove >= tHeight) {
        tooltipTop = rect.top - PADDING - 12 - tHeight;
    } else if (position === 'bottom' || spaceBelow >= tHeight || spaceBelow > spaceAbove) {
        tooltipTop = rect.bottom + PADDING + 12;
    } else {
        tooltipTop = rect.top - PADDING - 12 - tHeight;
    }

    let tooltipLeft = rect.left + (rect.width - tWidth) / 2;
    tooltipLeft = Math.max(12, Math.min(tooltipLeft, window.innerWidth - tWidth - 12));
    tooltipTop  = Math.max(12, Math.min(tooltipTop, window.innerHeight - tooltip.offsetHeight - 12));

    tooltip.style.top  = `${tooltipTop}px`;
    tooltip.style.left = `${tooltipLeft}px`;
}

function closeTutorial() {
    const overlay = document.getElementById('tutorial-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.onclick = null;
    }
    if (spotlightEl) spotlightEl.style.display = 'none';

    const nextBtn = document.getElementById('tutorial-btn-next');
    if (nextBtn) nextBtn.classList.remove('tutorial-btn-nudge');

    // Remove window resize/scroll realignment handlers on exit
    if (window._tutorialResizeHandler) {
        window.removeEventListener('resize', window._tutorialResizeHandler);
        window.removeEventListener('scroll', window._tutorialResizeHandler);
        window._tutorialResizeHandler = null;
    }

    // Haptic
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
}

function checkAndShowWelcome() {
    if (welcomeChecked) return;
    welcomeChecked = true;
    if (shouldShowWelcome()) {
        setTimeout(() => {
            showWelcomeModal();
        }, 600);
    }
}

// ---- Auto-show on startup (after profile loads) ----
(function initWelcome() {
    // Bind the help button click to manually start the tutorial
    const helpBtn = document.getElementById('btn-tutorial-help');
    if (helpBtn) {
        helpBtn.onclick = (e) => {
            e.stopPropagation();
            startTutorial();
        };
    }
})();

