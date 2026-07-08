// --- CONFIGURATION ---
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : 'https://api.YOUR_DOMAIN.com'; // Замените на домен прокси (Cloudflare) при деплое

// Инициализация Telegram WebApp
const tg = window.Telegram?.WebApp;
let initData = '';
let currentUser = { id: 0, username: 'Player', first_name: 'Player', balance: 0 };
let currentRoomId = null;
let lobbySocket = null;
let gameSocket = null;

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
    
    gameplayScreen: document.getElementById('gameplay-screen'),
    gameRoomId: document.getElementById('game-room-id'),
    namePlayerOwner: document.getElementById('name-player-owner'),
    namePlayerOpponent: document.getElementById('name-player-opponent'),
    diceOwner: document.getElementById('dice-owner'),
    diceOpponent: document.getElementById('dice-opponent'),
    gameStatusText: document.getElementById('game-status-text'),
    matchResults: document.getElementById('match-results'),
    resultTitle: document.getElementById('result-title'),
    resultSubtitle: document.getElementById('result-subtitle'),
    btnReturnLobby: document.getElementById('btn-return-lobby'),
    
    toastContainer: document.getElementById('toast-container')
};

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (УВЕДОМЛЕНИЯ) ---
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
    } catch (e) {
        showToast("Error connecting to server", "error");
        console.error(e);
    }
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
        const rooms = await res.json();
        renderRooms(rooms);
    } catch (e) {
        console.error("Failed to fetch rooms list");
    }
}

function renderRooms(rooms) {
    if (rooms.length === 0) {
        elements.roomsList.innerHTML = `
            <div class="no-rooms-message">
                <i class="fa-solid fa-gamepad text-muted"></i>
                <p>No active rooms. Create your own bet!</p>
            </div>
        `;
        return;
    }
    
    elements.roomsList.innerHTML = rooms.map(room => `
        <div class="room-card-item" id="room-${room.id}">
            <div class="room-info-side">
                <span class="room-bet-amount">${room.bet.toLocaleString()} 🪙</span>
                <span class="room-owner-name">by @${room.owner_username}</span>
            </div>
            <div class="room-action-side">
                <button class="btn-join" onclick="joinRoom('${room.id}')">Join Game</button>
            </div>
        </div>
    `).join('');
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
        openGameplayScreen(roomId, false, data.bet);
        
        // Запускаем анимацию броска
        playDiceRoll(data.rolls.owner, data.rolls.opponent, data);
    } catch (e) {
        showToast("Connection failed", "error");
    }
}

function openGameplayScreen(roomId, isOwner, bet) {
    currentRoomId = roomId;
    elements.gameRoomId.textContent = `Room ID: ${roomId}`;
    elements.gameplayScreen.classList.remove('hidden');
    elements.matchResults.classList.add('hidden');
    elements.gameStatusText.classList.remove('hidden');
    
    // Сбрасываем 3D кости на грань "1"
    elements.diceOwner.style.transform = 'rotateX(0deg) rotateY(0deg)';
    elements.diceOpponent.style.transform = 'rotateX(0deg) rotateY(0deg)';
    
    if (isOwner) {
        elements.namePlayerOwner.textContent = currentUser.username || currentUser.first_name;
        elements.namePlayerOpponent.textContent = "Waiting...";
        elements.gameStatusText.textContent = "Waiting for an opponent to join...";
        
        // Подключаемся к WebSocket комнаты для отслеживания старта игры бэкендом
        connectGameSocket(roomId);
    } else {
        elements.namePlayerOwner.textContent = "Opponent";
        elements.namePlayerOpponent.textContent = currentUser.username || currentUser.first_name;
        elements.gameStatusText.textContent = "Rolling the dice...";
    }
}

function playDiceRoll(ownerRoll, opponentRoll, gameResult) {
    elements.gameStatusText.textContent = "🎲 Shaking the cups...";
    
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
    rollDice(elements.diceOwner, ownerRoll, () => {});
    rollDice(elements.diceOpponent, opponentRoll, () => {
        // Показ результатов после завершения вращения
        elements.gameStatusText.classList.add('hidden');
        showGameResults(gameResult);
    });
}

function showGameResults(result) {
    elements.matchResults.classList.remove('hidden');
    const isOwner = result.winner_id === currentUser.id;
    const isWinner = result.winner_id === currentUser.id;
    
    if (result.is_draw) {
        elements.matchResults.className = "match-results-box draw";
        elements.resultTitle.textContent = "🤝 Tie roll!";
        elements.resultSubtitle.textContent = "All bets returned.";
    } else if (isWinner) {
        elements.matchResults.className = "match-results-box victory";
        elements.resultTitle.textContent = "🏆 Victory!";
        elements.resultSubtitle.textContent = `+${(result.bet * 2).toLocaleString()} coins`;
        if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    } else {
        elements.matchResults.className = "match-results-box defeat";
        elements.resultTitle.textContent = "🌚 Defeat";
        elements.resultSubtitle.textContent = `-${result.bet.toLocaleString()} coins`;
        if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
    }
    
    // Обновляем профиль с новым балансом
    fetchUserProfile();
}

// --- WEBSOCKETS СОЕДИНЕНИЯ ---

function connectLobbySocket() {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = API_BASE_URL.replace(/^http/, 'ws');
    
    lobbySocket = new WebSocket(`${wsUrl}/api/ws/lobby`);
    
    lobbySocket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'room_created' || msg.type === 'room_deleted') {
            fetchActiveRooms();
        }
    };
    
    lobbySocket.onclose = () => {
        console.log("Lobby socket closed. Reconnecting...");
        setTimeout(connectLobbySocket, 3000);
    };
}

function connectGameSocket(roomId) {
    const wsUrl = API_BASE_URL.replace(/^http/, 'ws');
    
    gameSocket = new WebSocket(`${wsUrl}/api/ws/game/${roomId}`);
    
    gameSocket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'game_finished') {
            // Другой игрок вошел и игра рассчитана
            const result = msg.result;
            elements.namePlayerOpponent.textContent = "Opponent";
            playDiceRoll(result.rolls.owner, result.rolls.opponent, result);
            
            // Закрываем WebSocket
            gameSocket.close();
        }
    };
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

elements.btnClaimGift.onclick = () => {
    claimDailyGift();
};

elements.btnReturnLobby.onclick = () => {
    elements.gameplayScreen.classList.add('hidden');
    fetchActiveRooms();
};

// Экспортируем функцию для inline вызова из HTML
window.joinRoom = joinRoom;

// --- ИНИЦИАЛИЗАЦИЯ ПРИ ЗАПУСКЕ ---
fetchUserProfile();
fetchActiveRooms();
connectLobbySocket();
