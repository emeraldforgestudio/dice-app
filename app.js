// --- CONFIGURATION ---
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : 'https://slideshow-similarly-settings-helicopter.trycloudflare.com'; 
let BOT_USERNAME = 'VerdeCasinoBot'; 
let globalVaultAddress = "EQDgBza6Feso19dmBpYqJiv95ZgQnZKCuXvO0LIAvvXjf6Z1";

// Fetch dynamic config
// --- SOUND MANAGER ---
const gameSounds = {
    click: new Audio('assets/sounds/click.wav'),
    roll: new Audio('assets/sounds/roll.wav'),
    success: new Audio('assets/sounds/success.wav'),
    error: new Audio('assets/sounds/error.wav'),
    coin: new Audio('assets/sounds/coin.wav'),
    pop: new Audio('assets/sounds/pop.wav'),
    cancel: new Audio('assets/sounds/cancel.wav')
};

function playSound(name) {
    try {
        if (gameSounds[name]) {
            gameSounds[name].currentTime = 0;
            // Устанавливаем 20% для 'coin', для остальных 40%
            gameSounds[name].volume = (name === 'coin') ? 0.2 : 0.4;
            gameSounds[name].play().catch(e => { console.warn('Sound error:', e) });
        }
    } catch(e){}
}

fetch(`${API_BASE_URL}/api/config`)
    .then(r => r.json())
    .then(data => { if(data.vault_address) globalVaultAddress = data.vault_address; })
    .catch(console.error);

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function maskUsername(username) {
    if (!username) return "anonymous";
    let clean = username.startsWith("@") ? username.slice(1) : username;
    if (clean.length <= 1) return clean + "*";
    if (clean.length === 2) return clean[0] + "*";
    return clean[0] + "*".repeat(clean.length - 2) + clean[clean.length - 1];
}

let currentBetCurrency = 'coins'; // 'coins' or 'ton'
let tonConnectUI = null;
let userTonAddress = null;

// Инициализация Telegram WebApp
const tg = window.Telegram?.WebApp;
let initData = '';
let currentUser = { id: 0, username: 'Player', first_name: 'Player', balance: 0, bonus_cooldown: null };
let currentRoomId = null;
let currentRoomBet = 0;
let currentRoomCurrency = 'coins';
let weAreRoomOwner = false;
let roomPollInterval = null;
let gameSocket = null;
let activeRooms = [];
let lastRenderedRoomsHash = "";
let welcomeChecked = false;

// Параметры фильтрации и пагинации
let currentFilterType = 'all'; // 'all', 'own', 'other'
let currentCurrencyFilter = 'coins'; // 'all', 'coins', 'ton'
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
    console.log("⚠️ Running outside Telegram. Showing error message.");
    document.addEventListener("DOMContentLoaded", () => {
        document.body.innerHTML = '<div style="color:white;text-align:center;margin-top:20px;font-family:sans-serif;"><h2>Access Denied</h2><p>Please open this application inside Telegram.</p></div>';
    });
    throw new Error("Cannot run outside Telegram");
}

function tonAddressToUserFriendly(rawAddress, isTestnet = true) {
    if (!rawAddress) return '';
    if (window.TON_CONNECT_UI && typeof window.TON_CONNECT_UI.toUserFriendlyAddress === 'function') {
        return window.TON_CONNECT_UI.toUserFriendlyAddress(rawAddress, isTestnet);
    }
    if (window.TonConnectUI && typeof window.TonConnectUI.toUserFriendlyAddress === 'function') {
        return window.TonConnectUI.toUserFriendlyAddress(rawAddress, isTestnet);
    }
    return rawAddress;
}

// Инициализация TON Connect UI
function initTonConnect() {
    try {
        const TONSDK = window.TON_CONNECT_UI || window.TonConnectUI;
        if (TONSDK && document.getElementById('ton-connect-btn')) {
            tonConnectUI = new TONSDK.TonConnectUI({
                manifestUrl: 'https://raw.githubusercontent.com/emeraldforgestudio/dice-app/main/tonconnect-manifest.json',
                buttonRootId: 'ton-connect-btn'
            });

            tonConnectUI.onStatusChange(async (wallet) => {
                if (wallet) {
                    // Защита от дурака: блокируем Mainnet кошельки (-239), разрешаем только Testnet (-3)
                    if (wallet.account.chain === "-239") {
                        showToast("⚠️ MAINNET BLOCKED! Please switch your wallet to TON Testnet.", "error");
                        await tonConnectUI.disconnect();
                        return;
                    }
                    
                    userTonAddress = tonAddressToUserFriendly(wallet.account.address, true);
                    console.log('💎 TON Wallet connected:', userTonAddress);
                    closeTonWarningModal();
                    updateHeaderTonConnectButton();
                    toggleActiveBalance('ton');
                    updateTonBalanceDisplay();
                    setCurrencyFilter('all');
                    applyFiltersAndRender();
                } else {
                    userTonAddress = null;
                    console.log('💎 TON Wallet disconnected');
                    updateHeaderTonConnectButton();
                    toggleActiveBalance('coins');
                    const tonDisplay = document.getElementById('ton-balance-display');
                    if (tonDisplay) tonDisplay.innerText = '0.00 💎';
                    setCurrencyFilter('coins');
                    applyFiltersAndRender();
                }
            });
        }
    } catch (err) {
        console.warn('TonConnect initialization warning:', err);
    }
    
    setupTonWarningModalEvents();
    updateHeaderTonConnectButton();
}

function updateHeaderTonConnectButton() {
    const headerBtnContainer = document.getElementById('ton-connect-btn');
    if (!headerBtnContainer) return;
    
    const tonSvgIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle;"><path d="M12 2L2 8.5L12 22L22 8.5L12 2Z" fill="white" stroke="white" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 2V22" stroke="#0088cc" stroke-width="1.5"/><path d="M2 8.5L12 13L22 8.5" stroke="#0088cc" stroke-width="1.5"/></svg>`;

    if (userTonAddress) {
        const shortAddr = userTonAddress.slice(0, 6) + '...' + userTonAddress.slice(-6);
        headerBtnContainer.innerHTML = `<button class="btn-preset-ton connected" onclick="handleHeaderTonButtonClick()">${tonSvgIcon} ${shortAddr}</button>`;
    } else {
        headerBtnContainer.innerHTML = `<button class="btn-preset-ton" onclick="handleHeaderTonButtonClick()">${tonSvgIcon} Connect TON</button>`;
    }
}

function handleHeaderTonButtonClick() {
    if (userTonAddress) {
        // Если кошелек уже подключен, открываем поп-ап настроек (Settings)
        openTonSettingsModal();
    } else {
        // Если кошелек не подключен, показываем предупреждающий поп-ап
        openTonWarningModal();
    }
}

function openTonConnectFromModal() {
    closeTonWarningModal();
    if (tonConnectUI) {
        tonConnectUI.openModal();
    }
}

function openTonWarningModal() {
    const modal = document.getElementById('ton-warning-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeTonWarningModal() {
    const modal = document.getElementById('ton-warning-modal');
    if (modal) modal.classList.add('hidden');
}

function openTonSettingsModal() {
    const modal = document.getElementById('ton-settings-modal');
    const addrDiv = document.getElementById('ton-settings-address');
    if (addrDiv && userTonAddress) {
        addrDiv.innerText = userTonAddress;
    }
    if (modal) modal.classList.remove('hidden');
}

function closeTonSettingsModal() {
    const modal = document.getElementById('ton-settings-modal');
    if (modal) modal.classList.add('hidden');
}

async function disconnectTonWalletFromSettings() {
    if (tonConnectUI) {
        try {
            await tonConnectUI.disconnect();
            showToast("TON Wallet disconnected", "info");
        } catch (err) {
            console.error("Error disconnecting wallet:", err);
        }
    }
    closeTonSettingsModal();
}

function setupTonWarningModalEvents() {
    const closeBtn = document.getElementById('btn-close-ton-warning-modal');
    const cancelBtn = document.getElementById('btn-cancel-ton-warning');
    const modal = document.getElementById('ton-warning-modal');
    
    if (closeBtn) closeBtn.onclick = closeTonWarningModal;
    if (cancelBtn) cancelBtn.onclick = closeTonWarningModal;
    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) closeTonWarningModal();
        };
    }

    const settingsCloseBtn = document.getElementById('btn-close-ton-settings-modal');
    const settingsModal = document.getElementById('ton-settings-modal');
    if (settingsCloseBtn) settingsCloseBtn.onclick = closeTonSettingsModal;
    if (settingsModal) {
        settingsModal.onclick = (e) => {
            if (e.target === settingsModal) closeTonSettingsModal();
        };
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTonConnect);
} else {
    initTonConnect();
}

async function updateTonBalanceDisplay() {
    if (!userTonAddress) return;
    try {
        const response = await fetch(`https://testnet.toncenter.com/api/v2/getAddressInformation?address=${userTonAddress}`);
        const data = await response.json();
        if (data.ok) {
            const balanceNano = parseInt(data.result.balance || 0);
            const balanceTon = (balanceNano / 1e9).toFixed(2);
            document.getElementById('ton-balance-display').innerText = `${balanceTon} \uD83D\uDC8E`;
            
            const matchBalEl = document.getElementById('match-new-balance');
            if (matchBalEl && typeof currentRoomCurrency !== 'undefined' && currentRoomCurrency === 'ton') {
                matchBalEl.innerText = `${balanceTon} \uD83D\uDC8E`;
            }
        }
    } catch (e) {
        console.error('Failed to fetch TON balance:', e);
    }
}

let activeHeaderBalanceMode = 'coins'; // 'coins' or 'ton'

function toggleActiveBalance(forceMode = null) {
    if (forceMode) {
        activeHeaderBalanceMode = forceMode;
    } else {
        activeHeaderBalanceMode = (activeHeaderBalanceMode === 'coins') ? 'ton' : 'coins';
    }

    const coinsBox = document.getElementById('balance-coins-box');
    const tonBox = document.getElementById('balance-ton-box');

    if (activeHeaderBalanceMode === 'ton') {
        if (coinsBox) coinsBox.classList.add('hidden');
        if (tonBox) {
            tonBox.classList.remove('hidden');
            tonBox.style.display = 'flex';
        }
    } else {
        if (tonBox) tonBox.classList.add('hidden');
        if (coinsBox) coinsBox.classList.remove('hidden');
    }
}
window.toggleActiveBalance = toggleActiveBalance;

function selectBetCurrency(currency) {
    currentBetCurrency = currency;
    toggleActiveBalance(currency);

    const coinsBtn = document.getElementById('mode-coins-btn');
    const tonBtn = document.getElementById('mode-ton-btn');
    const symbolDisplay = document.getElementById('currency-symbol-display');
    const labelBet = document.getElementById('label-bet-amount');
    const presetCoins = document.getElementById('preset-bets-coins');
    const presetTon = document.getElementById('preset-bets-ton');
    const inputBet = document.getElementById('input-bet');

    const testnetWarning = document.getElementById('ton-testnet-warning');

    if (currency === 'ton') {
        coinsBtn.classList.remove('active');
        tonBtn.classList.add('active');
        symbolDisplay.innerText = '💎';
        labelBet.innerText = 'Enter Bet Amount (TON Testnet)';
        presetCoins.classList.add('hidden');
        presetTon.classList.remove('hidden');
        if (testnetWarning) testnetWarning.classList.remove('hidden');
        inputBet.placeholder = 'e.g. 0.5';
        inputBet.min = '0.05';
        inputBet.step = '0.1';
        inputBet.value = '';
    } else {
        tonBtn.classList.remove('active');
        coinsBtn.classList.add('active');
        symbolDisplay.innerText = '🪙';
        labelBet.innerText = 'Enter Bet Amount (Coins)';
        presetTon.classList.add('hidden');
        presetCoins.classList.remove('hidden');
        if (testnetWarning) testnetWarning.classList.add('hidden');
        inputBet.placeholder = 'e.g. 500';
        inputBet.min = '10';
        inputBet.step = '10';
        inputBet.value = '';
    }
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
    btnClearBet: document.getElementById('btn-clear-bet'),
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
    btnConfirmActionCancelRoom: document.getElementById('btn-confirm-action-cancel-room'),
    
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
    
    // Новое модальное окно рекламы
    adsInfoModal: document.getElementById('ads-info-modal'),
    btnCloseAdsInfoModal: document.getElementById('btn-close-ads-info-modal'),
    btnVisitChannel: document.getElementById('btn-visit-channel'),

    // Окно предупреждения для дев-плеера (наблюдателя)
    devPlayerWarnModal: document.getElementById('dev-player-warn-modal'),
    btnCloseDevWarnModal: document.getElementById('btn-close-dev-warn-modal'),
    btnDevWarnVisitChannel: document.getElementById('btn-dev-warn-visit-channel'),
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
    if (type === 'success') playSound('success');
    else if (type === 'error') playSound('error');
    else playSound('pop');

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
            if (typeof currentRoomCurrency === 'undefined' || currentRoomCurrency !== 'ton') {
                matchBalEl.textContent = `${currentUser.balance.toLocaleString()} 🪙`;
            }
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
        showToast(`Server error: ${e.message || e}`, "error");
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
        if (!res.ok) return;
        activeRooms = await res.json();
        renderRooms(activeRooms);
    } catch (e) {
        console.error("Failed to fetch rooms list:", e);
    }
}

async function syncLobbyData() {
    try {
        await Promise.all([
            fetchUserProfile(),
            fetchActiveRooms()
        ]);
    } catch (e) {
        // Silent fail for background sync
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

    // Фильтр по валюте комнат (все / монеты / ton)
    if (currentCurrencyFilter === 'coins') {
        filtered = filtered.filter(r => r.currency !== 'ton');
    } else if (currentCurrencyFilter === 'ton') {
        filtered = filtered.filter(r => r.currency === 'ton');
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
    
    // 2. Сортировка: TON комнаты ВСЕГДА идут первыми наверх
    filtered.sort((a, b) => {
        const aIsTon = a.currency === 'ton' ? 1 : 0;
        const bIsTon = b.currency === 'ton' ? 1 : 0;
        
        if (aIsTon !== bIsTon) {
            return bIsTon - aIsTon; // TON комнаты (1) идут раньше обычных (0)
        }
        
        // Внутри одной категории валют применяем выбранный режим сортировки
        if (currentSortType === 'bet-asc') {
            return a.bet - b.bet;
        } else if (currentSortType === 'bet-desc') {
            return b.bet - a.bet;
        } else if (currentSortType === 'newest') {
            return b.id.localeCompare(a.id);
        }
        return 0;
    });
    
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
    const renderHash = paginated.map(r => `${r.id}:${r.bet}:${r.currency}:${r.owner_username}:${r.is_private}`).join('|');
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
        const safeDisplayName = escapeHtml(displayName);
        const safeOwnerUsername = escapeHtml(room.owner_username || "");
            
        const isTon = room.currency === 'ton';
        const betFormatted = isTon 
            ? `${room.bet} 💎 <!-- <span style="font-size: 9px; color: #ffc107; background: rgba(255,193,7,0.15); padding: 1px 4px; border-radius: 4px; border: 1px solid rgba(255,193,7,0.3);">TESTNET</span> -->` 
            : `${room.bet.toLocaleString()} 🪙`;

        // Если комната принадлежит текущему пользователю, показываем кнопку Cancel
        const actionButton = isOwn
            ? `<button class="btn-join btn-cancel-lobby" onclick="confirmCancelRoom('${room.id}', ${room.bet}, '${room.currency}')">Cancel</button>`
            : `<button class="btn-join" onclick="confirmJoinRoom('${room.id}', '${safeOwnerUsername}', ${room.bet})">Join Bet</button>`;
            
        const isPrivate = room.is_private === true;
        const privateBadge = isPrivate 
            ? `<span class="private-badge"><i class="fa-solid fa-eye-slash"></i> Hidden</span>`
            : '';
            
        const isOwnClickHtml = isOwn
            ? `onclick="if (!event.target.closest('button')) openGameplayScreen('${room.id}', true, ${room.bet}, null, '${room.currency}')"`
            : '';
            
        return `
            <div class="room-card-item ${isPrivate ? 'private-room-card' : ''} ${isOwn ? 'my-room-card-clickable' : ''}" id="room-${room.id}" ${isOwnClickHtml}>
                <div class="room-info-side">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="room-bet-amount">${betFormatted}</span>
                        ${privateBadge}
                    </div>
                    <span class="room-owner-name">by ${safeDisplayName}</span>
                </div>
                <div class="room-action-side">
                    ${actionButton}
                </div>
            </div>
        `;
    }).join('');
}

// Хелпер: формирование валидного 100% нативного TON Cell BOC без внешних библиотек
function encodeTactPayload(opcodeHex, gameIdNum) {
    // 1. Формируем данные (12 байт: 4 байта opcode + 8 байт uint64)
    const dataBuffer = new ArrayBuffer(12);
    const view = new DataView(dataBuffer);
    view.setUint32(0, parseInt(opcodeHex, 16), false);
    view.setBigUint64(4, gameIdNum || 0n, false);
    const payloadBytes = new Uint8Array(dataBuffer);

    // 2. Стандартный заголовок BOC для одной ячейки (12 байт, 0 ссылок)
    const headerBytes = new Uint8Array([
        0xb5, 0xee, 0x9c, 0x72, // magic
        0x41, 0x01, 0x01, 0x01, // flags (has_crc32c=1), 1 cell, 1 root, 0 absent
        0x00, 0x0e, 0x00,       // root offset=0, cells length=14, root cell=0
        0x00, 0x18              // cell refs=0, cell size desc=24 (12 bytes)
    ]);

    // 3. Соединяем
    const bocWithoutCrc = new Uint8Array(headerBytes.length + payloadBytes.length);
    bocWithoutCrc.set(headerBytes, 0);
    bocWithoutCrc.set(payloadBytes, headerBytes.length);

    // 4. Считаем официальный CRC32-C (по стандарту TON)
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bocWithoutCrc.length; i++) {
        crc ^= bocWithoutCrc[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc & 1) ? (crc >>> 1) ^ 0x82F63B78 : (crc >>> 1);
        }
    }
    crc = (crc ^ 0xFFFFFFFF) >>> 0;

    // 5. Записываем CRC32-C в конец (Little-Endian)
    const finalBoc = new Uint8Array(bocWithoutCrc.length + 4);
    finalBoc.set(bocWithoutCrc, 0);
    const crcView = new DataView(finalBoc.buffer);
    crcView.setUint32(bocWithoutCrc.length, crc, true);

    // 6. Конвертируем в Base64
    let binary = '';
    for (let i = 0; i < finalBoc.length; i++) {
        binary += String.fromCharCode(finalBoc[i]);
    }
    return btoa(binary);
}

function encodeCreateGamePayload(opcodeHex, gameIdNum, betNanoString) {
    const dataBuffer = new ArrayBuffer(20);
    const view = new DataView(dataBuffer);
    
    view.setUint32(0, parseInt(opcodeHex, 16), false); 
    view.setBigUint64(4, gameIdNum || 0n, false); 
    
    const betBigInt = BigInt(betNanoString);
    view.setBigUint64(12, betBigInt, false);

    const payloadBytes = new Uint8Array(dataBuffer);

    const headerBytes = new Uint8Array([
        0xb5, 0xee, 0x9c, 0x72,
        0x41, 0x01, 0x01, 0x01,
        0x00, 0x16, 0x00,
        0x00, 0x28
    ]);

    const bocWithoutCrc = new Uint8Array(headerBytes.length + payloadBytes.length);
    bocWithoutCrc.set(headerBytes, 0);
    bocWithoutCrc.set(payloadBytes, headerBytes.length);

    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bocWithoutCrc.length; i++) {
        crc ^= bocWithoutCrc[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc & 1) ? (crc >>> 1) ^ 0x82F63B78 : (crc >>> 1);
        }
    }
    crc = (crc ^ 0xFFFFFFFF) >>> 0;

    const finalBoc = new Uint8Array(bocWithoutCrc.length + 4);
    finalBoc.set(bocWithoutCrc, 0);
    const crcView = new DataView(finalBoc.buffer);
    crcView.setUint32(bocWithoutCrc.length, crc, true);

    let binary = '';
    for (let i = 0; i < finalBoc.length; i++) {
        binary += String.fromCharCode(finalBoc[i]);
    }
    return btoa(binary);
}

async function createRoom(bet, isPrivate) {
    try {
        if (currentBetCurrency === 'ton') {
            if (!tonConnectUI || !userTonAddress) {
                showToast("Please connect your TON wallet first!", "error");
                return;
            }
        }

        // 1. Сначала создаем комнату на бэкенде чтобы получить ID
        const res = await fetch(`${API_BASE_URL}/api/rooms/create`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ bet, currency: currentBetCurrency, is_private: isPrivate })
        });
        const data = await res.json();
        
        if (!handleApiResponse(res, data, "Failed to create room")) {
            return;
        }

        const roomId = data.room_id;
        const numericRoomId = BigInt("0x" + roomId.toString().replace('-', '').substring(0, 16));

        elements.createRoomModal.classList.add('hidden');
        openGameplayScreen(roomId, true, bet, null, currentBetCurrency);
        // 2. Для TON комнат запрашиваем подтверждение в кошельке используя ID от бэкенда
        if (currentBetCurrency === 'ton') {
            const attachAmount = (parseFloat(bet) + 0.02).toString();
            const nanoAttach = Math.round(attachAmount * 1e9).toString();
            const nanoBet = Math.round(bet * 1e9).toString();
            const vaultContractAddress = globalVaultAddress;

            showToast("Please confirm transaction in your TON wallet...", "info");

            const transaction = {
                validUntil: Math.floor(Date.now() / 1000) + 300,
                messages: [
                    {
                        address: vaultContractAddress,
                        amount: nanoAttach,
                        payload: encodeCreateGamePayload("41f0a601", numericRoomId, nanoBet) // CreateGame op-code (updated for v5.1)
                    }
                ]
            };

            try {
                const txResult = await tonConnectUI.sendTransaction(transaction);
                console.log("💎 TON Transaction sent:", txResult);
                
                // 3. Подтверждаем бэкенду что оплата прошла, чтобы он разослал комнату всем
                const confirmRes = await fetch(`${API_BASE_URL}/api/rooms/confirm_ton/${roomId}`, {
                    method: 'POST',
                    headers: getHeaders()
                });
                
                if (!confirmRes.ok) {
                    throw new Error("Blockchain confirmation timeout or error");
                }
                
                showToast("TON deposit confirmed!", "success");
            } catch (txError) {
                console.error("TON Tx failed/cancelled:", txError);
                showToast("TON transfer failed or cancelled in wallet!", "error");
                
                // Удаляем комнату на бэкенде, так как транзакция не прошла
                try {
                    await fetch(`${API_BASE_URL}/api/rooms/delete/${roomId}`, {
                        method: 'POST',
                        headers: getHeaders()
                    });
                } catch (e) {
                    console.error("Failed to delete unpaid room", e);
                }
                if (gameSocket) { gameSocket.close(); gameSocket = null; }
                if (elements.gameplayScreen) elements.gameplayScreen.classList.add('hidden');
                if (elements.ownerWaitingActions) elements.ownerWaitingActions.classList.add('hidden');
                syncLobbyData();
                return; 
            }
        }
        
        const roomsLeftText = data.rooms_left !== undefined ? ` (${data.rooms_left} rooms left)` : "";
        if (currentBetCurrency !== 'ton') {
            showToast(`Room created successfully!${roomsLeftText}`, "success");
        } else {
            showToast(`Room registered successfully!${roomsLeftText}`, "success");
        }
        
        fetchUserProfile();
        if (currentBetCurrency === 'ton') {
            setTimeout(updateTonBalanceDisplay, 3000);
        }
        
        setTimeout(() => {
            if (elements.btnKeepRoomLobby) {
                elements.btnKeepRoomLobby.classList.add('shimmer-glow');
                setTimeout(() => {
                    if (elements.btnKeepRoomLobby) {
                        elements.btnKeepRoomLobby.classList.remove('shimmer-glow');
                    }
                }, 1400);
            }
        }, 3000);
    } catch (e) {
        showToast("Network error", "error");
    }
}

async function joinRoom(roomId) {
    try {
        // Проверяем, является ли комната TON комнатой
        const roomObj = activeRooms.find(r => r.id === roomId);
        const numericRoomId = BigInt("0x" + roomId.toString().replace('-', '').substring(0, 16));

        if (roomObj && roomObj.currency === 'ton') {
            if (!tonConnectUI || !userTonAddress) {
                showToast("Please connect your TON wallet first!", "error");
                return;
            }

            const attachAmount = (parseFloat(roomObj.bet) + 0.02).toString();
            const nanoAttach = Math.round(attachAmount * 1e9).toString();
            const vaultContractAddress = globalVaultAddress;

            showToast("Please confirm transaction in your TON wallet...", "info");

            const transaction = {
                validUntil: Math.floor(Date.now() / 1000) + 300,
                messages: [
                    {
                        address: vaultContractAddress,
                        amount: nanoAttach,
                        payload: encodeTactPayload("192d165d", numericRoomId) // JoinGame op-code 0x192d165d
                    }
                ]
            };

            openGameplayScreen(roomId, false, roomObj.bet, null, roomObj.currency);

            try {
                const txResult = await tonConnectUI.sendTransaction(transaction);
                console.log("💎 TON Join Transaction sent:", txResult);
                
                showToast("TON deposit confirmed! Joining match...", "success");
                setTimeout(updateTonBalanceDisplay, 3000);
            } catch (txError) {
                console.error("TON Join Tx failed/cancelled:", txError);
                showToast("Transaction cancelled or failed in wallet", "error");
                
                try {
                    await fetch(`${API_BASE_URL}/api/rooms/leave/${roomId}`, {
                        method: 'POST',
                        headers: getHeaders()
                    });
                } catch (e) {}
                
                if (gameSocket) { gameSocket.close(); gameSocket = null; }
                if (elements.gameplayScreen) elements.gameplayScreen.classList.add('hidden');
                syncLobbyData();
                return;
            }
        } else {
            openGameplayScreen(roomId, false, roomObj ? roomObj.bet : 0, null, roomObj ? roomObj.currency : 'coins');
        }

        showToast("Connecting to match...", "info");
        
        const res = await fetch(`${API_BASE_URL}/api/rooms/join/${roomId}`, {
            method: 'POST',
            headers: getHeaders()
        });
        const data = await res.json();
        
        if (!handleApiResponse(res, data, "Unable to join room")) {
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
            if (gameSocket) { gameSocket.close(); gameSocket = null; }
            if (elements.gameplayScreen) elements.gameplayScreen.classList.add('hidden');
            if (elements.lobbyScreen) elements.lobbyScreen.classList.remove('hidden');
            loadRooms();
            return;
        }

        // We update with real data later
        openGameplayScreen(roomId, false, data.bet, data, data.currency);
        
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
        if (gameSocket) { gameSocket.close(); gameSocket = null; }
        if (elements.gameplayScreen) elements.gameplayScreen.classList.add('hidden');
        if (elements.lobbyScreen) elements.lobbyScreen.classList.remove('hidden');
    }
}

function confirmJoinRoom(roomId, ownerUsername, bet) {
    if (checkDevPlayer()) return;
    if (elements.confirmTitle) elements.confirmTitle.textContent = "Confirm Match Entry";
    if (elements.confirmOwner) elements.confirmOwner.textContent = `@${maskUsername(ownerUsername)}`;
    if (elements.confirmBet) elements.confirmBet.textContent = `${bet.toLocaleString()} 🪙`;
    if (elements.confirmMessageText) elements.confirmMessageText.textContent = "Are you sure you want to join this room? The bet amount will be immediately deducted from your balance.";
    
    // Показываем кнопку входа, скрываем кнопку отмены комнаты
    if (elements.btnConfirmActionSubmit) elements.btnConfirmActionSubmit.classList.remove('hidden');
    if (elements.btnConfirmActionCancelRoom) elements.btnConfirmActionCancelRoom.classList.add('hidden');
    
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

function confirmCancelRoom(roomId, bet, currency = 'coins') {
    if (elements.confirmTitle) elements.confirmTitle.textContent = "Cancel Match Creation";
    if (elements.confirmOwner) elements.confirmOwner.textContent = "You (Owner)";
    if (elements.confirmBet) elements.confirmBet.textContent = `${bet.toLocaleString()} ${currency === 'ton' ? 'TON' : 'coins'}`;
    if (elements.confirmMessageText) elements.confirmMessageText.textContent = "Are you sure you want to cancel this room? Your bet will be refunded to your balance (minus 0.01 TON fee).";
    
    // Показываем модалку
    if (elements.btnConfirmActionSubmit) elements.btnConfirmActionSubmit.classList.add('hidden');
    if (elements.btnConfirmActionCancelRoom) elements.btnConfirmActionCancelRoom.classList.remove('hidden');
    
    if (elements.confirmModal) elements.confirmModal.classList.remove('hidden');
    
    if (elements.btnConfirmActionCancelRoom) {
        elements.btnConfirmActionCancelRoom.onclick = async () => {
            if (elements.confirmModal) elements.confirmModal.classList.add('hidden');
            
            if (currency === 'ton') {
                const numericRoomId = BigInt("0x" + roomId.toString().replace('-', '').substring(0, 16));
                const vaultContractAddress = globalVaultAddress;

                showToast("Please confirm Cancel transaction in your TON wallet...", "info");

                const transaction = {
                    validUntil: Math.floor(Date.now() / 1000) + 300,
                    messages: [
                        {
                            address: vaultContractAddress,
                            amount: "50000000",
                            payload: encodeTactPayload("02e3056d", numericRoomId) // CancelGame op-code 0x02e3056d
                        }
                    ]
                };

                try {
                    await tonConnectUI.sendTransaction(transaction);
                    
                    // Удаляем комнату и с бэкенда тоже
                    try {
                        await fetch(`${API_BASE_URL}/api/rooms/delete/${roomId}`, {
                            method: 'POST',
                            headers: getHeaders()
                        });
                    } catch (e) {
                        console.error("Backend delete error", e);
                    }
                    
                    showToast("Cancellation transaction sent! Room is deleted.", "success");
                    syncLobbyData();
                } catch (e) {
                    console.error("Cancel TX error", e);
                    showToast("Transaction cancelled or failed.", "error");
                }
                return;
            }

            try {
                const res = await fetch(`${API_BASE_URL}/api/rooms/delete/${roomId}`, {
                    method: 'POST',
                    headers: getHeaders()
                });
                const data = await res.json();
                
                if (!handleApiResponse(res, data, "Unable to delete room")) {
                    return;
                }
                
                showToast("Room deleted and bet refunded!", "success");
                syncLobbyData();
            } catch (e) {
                showToast("Connection error", "error");
            }
        };
    }
}

function confirmDeleteRoom() {
    if (!currentRoomId) return;
    
    if (elements.confirmTitle) elements.confirmTitle.textContent = "Delete & Leave Room";
    if (elements.confirmOwner) elements.confirmOwner.textContent = "You (Owner)";
    if (elements.confirmBet) elements.confirmBet.textContent = `${currentRoomBet ? currentRoomBet.toLocaleString() : '0'} ${currentRoomCurrency === 'ton' ? 'TON' : 'coins'}`;
    
    // Скрываем кнопку входа, показываем кнопку отмены комнаты
    if (elements.btnConfirmActionSubmit) elements.btnConfirmActionSubmit.classList.add('hidden');
    if (elements.btnConfirmActionCancelRoom) elements.btnConfirmActionCancelRoom.classList.remove('hidden');
    
    if (elements.confirmModal) elements.confirmModal.classList.remove('hidden');
    
    if (elements.btnConfirmActionCancelRoom) {
        elements.btnConfirmActionCancelRoom.onclick = () => {
            if (elements.confirmModal) elements.confirmModal.classList.add('hidden');
            leaveRoom();
        };
    }
}

function setCurrencyFilter(currencyType) {
    currentCurrencyFilter = currencyType;
    
    const buttons = ['all', 'coins', 'ton'];
    buttons.forEach(b => {
        const btn = document.getElementById(`btn-currency-${b}`);
        if (btn) {
            if (b === currencyType) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
    
    currentPage = 1;
    renderRooms(activeRooms);
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

    if (currentRoomCurrency === 'ton') {
        const numericRoomId = BigInt("0x" + currentRoomId.toString().replace('-', '').substring(0, 16));
        const vaultContractAddress = globalVaultAddress;
        showToast("Please confirm Cancel transaction in your TON wallet...", "info");
        const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 300,
            messages: [{
                address: vaultContractAddress,
                amount: "50000000",
                payload: encodeTactPayload("02e3056d", numericRoomId)
            }]
        };
        try {
            await tonConnectUI.sendTransaction(transaction);
            
            // Удаляем комнату и с бэкенда
            try {
                await fetch(`${API_BASE_URL}/api/rooms/delete/${currentRoomId}`, {
                    method: 'POST',
                    headers: getHeaders()
                });
            } catch (e) {
                console.error("Backend delete error", e);
            }

            showToast("Cancellation transaction sent! Room deleted.", "success");
            if (gameSocket) { gameSocket.close(); gameSocket = null; }
            if (elements.gameplayScreen) elements.gameplayScreen.classList.add('hidden');
            if (elements.ownerWaitingActions) elements.ownerWaitingActions.classList.add('hidden');
            syncLobbyData();
        } catch (e) {
            console.error("Cancel TX error", e);
            showToast("Transaction cancelled or failed.", "error");
        }
        return;
    }

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
    
    copyTextToClipboard(url).then(() => {
        showToast("Invite link copied to clipboard!", "success");
    }).catch(() => {
        showToast("Failed to copy link", "error");
    });
}

function openGameplayScreen(roomId, isOwner, bet, result = null, currency = 'coins') {
    playSound('pop');
    currentRoomId = roomId;
    currentRoomBet = bet;
    currentRoomCurrency = currency;
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
        potElement.textContent = `${potAmount.toLocaleString()} ${currency === 'ton' ? 'TON' : '🪙'}`;
    }
    
    if (elements.gameplayScreen) {
        elements.gameplayScreen.classList.remove('hidden');
        if (currency === 'ton') {
            elements.gameplayScreen.classList.add('ton-room');
        } else {
            elements.gameplayScreen.classList.remove('ton-room');
        }
    }
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
    playSound('roll');
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
        if (currentRoomCurrency === 'ton') {
            setTimeout(updateTonBalanceDisplay, 2000);
        }
        
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
                        coin.textContent = currentRoomCurrency === 'ton' ? '\uD83D\uDC8E' : '\uD83E\uDE99';
                        
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
                playSound('success');
                if (elements.matchResults) elements.matchResults.className = "match-results-box victory";
                if (elements.resultTitle) elements.resultTitle.textContent = "🏆 Victory!";
                if (elements.resultSubtitle) elements.resultSubtitle.textContent = `+${(result.bet * 2).toLocaleString()} ${currentRoomCurrency === 'ton' ? 'TON' : 'coins'}`;
                if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            } else {
                playSound('error');
                if (elements.matchResults) elements.matchResults.className = "match-results-box defeat";
                if (elements.resultTitle) elements.resultTitle.textContent = "🌚 Defeat";
                if (elements.resultSubtitle) elements.resultSubtitle.textContent = `-${result.bet.toLocaleString()} ${currentRoomCurrency === 'ton' ? 'TON' : 'coins'}`;
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

// --- LOBBY POLLING & LIVE TOGGLE ---
let isLobbyLive = true;
let lobbyPollInterval = null;

function initLobbyPolling() {
    if (lobbyPollInterval) clearInterval(lobbyPollInterval);
    lobbyPollInterval = setInterval(() => {
        if (!isLobbyLive) return;
        if (document.hidden) return;
        if (elements.gameplayScreen && elements.gameplayScreen.classList.contains('hidden')) {
            syncLobbyData();
        }
    }, 10000);

    const liveIndicator = document.querySelector('.online-indicator');
    if (liveIndicator) {
        liveIndicator.style.cursor = 'pointer';
        liveIndicator.addEventListener('click', function() {
            isLobbyLive = !isLobbyLive;
            if (isLobbyLive) {
                this.innerHTML = '<span class="dot pulse" style="background-color: var(--neon-green)"></span> Live';
                syncLobbyData();
                showToast("Live updates enabled", "success");
            } else {
                this.innerHTML = '<span class="dot" style="background-color: gray;"></span> Paused';
                showToast("Live updates paused", "info");
            }
        });
    }
}

function startRoomPolling(roomId) {
    if (roomPollInterval) {
        clearInterval(roomPollInterval);
        roomPollInterval = null;
    }

    try {
        const wsUrl = API_BASE_URL.replace(/^http/, 'ws');
        if (gameSocket) gameSocket.close();
        gameSocket = new WebSocket(`${wsUrl}/api/ws/game/${roomId}`);
        gameSocket.onmessage = (event) => {
            // Instant trigger on any websocket event
            checkRoomStatus();
        };
    } catch (e) {
        console.log("Game WebSocket not available yet, falling back to polling");
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

// Вспомогательная функция для проверки режима наблюдателя (dev_player вне Telegram)
function checkDevPlayer() {
    if (currentUser && currentUser.username === 'player') {
        if (elements.devPlayerWarnModal) {
            elements.devPlayerWarnModal.classList.remove('hidden');
        }
        return true;
    }
    return false;
}

// Управление модальным окном
elements.btnCreateRoom.onclick = () => {
    playSound('click');
    if (checkDevPlayer()) return;
    elements.createRoomModal.classList.remove('hidden');
    
    if (userTonAddress) {
        selectBetCurrency('ton');
    } else {
        selectBetCurrency('coins');
    }
    
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
                const currentVal = parseFloat(elements.inputBet.value) || 0;
                playSound('coin');
                const presetVal = parseFloat(btn.dataset.val) || 0;
                const newVal = currentVal + presetVal;
                elements.inputBet.value = currentBetCurrency === 'ton' ? parseFloat(newVal.toFixed(2)) : Math.round(newVal);
            }
            return;
        }

        // Если тап пришелся на поле ввода или другие интерактивные кнопки, разрешаем стандартное поведение
        if (e.target === elements.inputBet || 
            e.target.closest('#btn-confirm-create') || 
            e.target.closest('#btn-close-create-modal') ||
            e.target.closest('#btn-clear-bet') ||
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
    playSound('cancel');
    elements.createRoomModal.classList.add('hidden');
};

if (elements.btnClearBet) {
    elements.btnClearBet.onclick = () => {
        if (elements.inputBet) {
            elements.inputBet.value = "";
        }
    };
}

// Выбор готовых пресетов ставок
document.querySelectorAll('.preset-bets').forEach(container => {
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-preset');
        if (!btn) return;
        const currentVal = parseFloat(elements.inputBet.value) || 0;
        playSound('coin');
                const presetVal = parseFloat(btn.dataset.val) || 0;
        const newVal = currentVal + presetVal;
        elements.inputBet.value = currentBetCurrency === 'ton' ? parseFloat(newVal.toFixed(2)) : Math.round(newVal);
    });
});

// Кнопка подтверждения создания комнаты
if (elements.btnConfirmCreate) {
    elements.btnConfirmCreate.onclick = () => {
        const bet = parseFloat(elements.inputBet.value);
        const isPrivate = elements.checkPrivate.checked;
        
        if (isNaN(bet) || bet <= 0) {
            showToast("Enter a valid bet amount", "error");
            return;
        }
        
        if (currentBetCurrency === 'coins' && bet > currentUser.balance) {
            showToast("Insufficient coins balance", "error");
            return;
        }
        
        createRoom(bet, isPrivate);
    };
}

if (elements.btnClaimGift) {
    elements.btnClaimGift.onclick = () => {
        if (checkDevPlayer()) return;
        showAdAndCountdown();
    };
}

if (elements.btnCloseDevWarnModal) {
    elements.btnCloseDevWarnModal.onclick = () => {
        if (elements.devPlayerWarnModal) {
            elements.devPlayerWarnModal.classList.add('hidden');
        }
    };
}

if (elements.btnDevWarnVisitChannel) {
    elements.btnDevWarnVisitChannel.onclick = () => {
        const channelUrl = 'https://t.me/verdecasino';
        if (tg && tg.openTelegramLink) {
            tg.openTelegramLink(channelUrl);
        } else {
            window.open(channelUrl, '_blank');
        }
    };
}

if (elements.btnCloseAdModal) {
    elements.btnCloseAdModal.onclick = () => {
        if (adTimer) clearInterval(adTimer);
        elements.adModal.classList.add('hidden');
    };
}

// Перехват клика по рекламному баннеру
const adLink = document.querySelector('.ad-banner-link');
if (adLink) {
    adLink.onclick = (e) => {
        e.preventDefault(); // Отменяем переход по пустой ссылке
        // Открываем модальное окно с деталями рекламы
        if (elements.adsInfoModal) {
            elements.adsInfoModal.classList.remove('hidden');
        }
    };
}

if (elements.btnCloseAdsInfoModal) {
    elements.btnCloseAdsInfoModal.onclick = () => {
        if (elements.adsInfoModal) {
            elements.adsInfoModal.classList.add('hidden');
        }
    };
}

if (elements.btnVisitChannel) {
    elements.btnVisitChannel.onclick = () => {
        const channelUrl = 'https://t.me/verdecasino';
        if (tg && tg.openTelegramLink) {
            tg.openTelegramLink(channelUrl);
        } else {
            window.open(channelUrl, '_blank');
        }
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
initLobbyPolling();
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


// Фоновое обновление лобби теперь управляется через initLobbyPolling()



// Клик по аватарке — открыть/закрыть уведомления (для наблюдателей player показывает предупреждение)
if (elements.userAvatarWrapper) {
    elements.userAvatarWrapper.onclick = () => {
        if (checkDevPlayer()) return;
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
                const name = escapeHtml(isMe ? rawName : maskedName);
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
                    ${e.currency === "ton" ? `<span class="lb-podium-score">${e.won_today.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 2})} 💎</span>` : `<span class="lb-podium-score">${e.won_today.toLocaleString()} 🪙</span>`}
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
                const name = escapeHtml(isMe ? rawName : maskedName);
                const initial = (e.first_name || e.username || 'P').charAt(0).toUpperCase();

                return `
                <div class="lb-list-item${isMe ? ' is-me' : ''}">
                    <span class="lb-list-rank">${e.rank}</span>
                    <div class="lb-list-avatar">${initial}</div>
                    <div class="lb-list-info">
                        <div class="lb-list-name">${isMe ? '⭐ ' + name : name}</div>
                        <div class="lb-list-league">${meta.label}</div>
                    </div>
                    ${e.currency === "ton" ? `<span class="lb-list-score">${e.won_today.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 2})} 💎</span>` : `<span class="lb-list-score">${e.won_today.toLocaleString()} 🪙</span>`}
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
                ${(myEntry.currency || "coins") === "ton" ? `<span class="lb-my-score">${(myEntry.won_today || 0).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 2})} 💎</span>` : `<span class="lb-my-score">${(myEntry.won_today || 0).toLocaleString()} 🪙</span>`}
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
            if (typeof checkAndShowWelcome === 'function') {
                checkAndShowWelcome();
            }
            if (currentUser.bot_username) {
                BOT_USERNAME = currentUser.bot_username;
            }
            elements.usernameDisplay.textContent = currentUser.username 
                ? `@${currentUser.username}` 
                : currentUser.first_name;
            elements.balanceDisplay.textContent = `${currentUser.balance.toLocaleString()} 🪙`;
            
            const matchBalEl = document.getElementById('match-new-balance');
            if (matchBalEl) {
                if (typeof currentRoomCurrency === 'undefined' || currentRoomCurrency !== 'ton') {
                    matchBalEl.textContent = `${currentUser.balance.toLocaleString()} 🪙`;
                }
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
        console.log("[Welcome] Current user welcome_seen status in DB:", currentUser.welcome_seen);
        if (currentUser.welcome_seen) {
            return false;
        }
    } else {
        console.log("[Welcome] currentUser is not set yet");
    }
    return true;
}

function markWelcomeSeen() {
    if (currentUser) {
        currentUser.welcome_seen = true;
    }

    // Call API to mark welcome seen in DB
    fetch(`${API_BASE_URL}/api/user/welcome-seen`, {
        method: 'POST',
        headers: getHeaders()
    }).then(res => res.json()).then(data => {
        console.log("[Welcome] Successfully marked welcome seen in DB:", data);
    }).catch(err => console.error("[Welcome] Failed to mark welcome seen in DB:", err));
}

function showWelcomeModal() {
    console.log("[Welcome] showWelcomeModal executed");
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
    console.log("[Welcome] checkAndShowWelcome called. welcomeChecked:", welcomeChecked);
    if (welcomeChecked) return;
    welcomeChecked = true;
    const shouldShow = shouldShowWelcome();
    console.log("[Welcome] shouldShowWelcome result:", shouldShow);
    if (shouldShow) {
        console.log("[Welcome] Scheduling showWelcomeModal in 600ms...");
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


