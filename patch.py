import re

with open('app.js', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Move openGameplayScreen up
code = code.replace(
    "const numericRoomId = parseInt(roomId.toString().substring(0, 8), 16) || 0;",
    "const numericRoomId = parseInt(roomId.toString().substring(0, 8), 16) || 0;\n\n        elements.createRoomModal.classList.add('hidden');\n        openGameplayScreen(roomId, true, bet);"
)

# 2. Add exit room logic on catch
code = code.replace(
    'console.error("Failed to delete unpaid room", e);\n                }\n                return; \n            }',
    'console.error("Failed to delete unpaid room", e);\n                }\n                if (gameSocket) { gameSocket.close(); gameSocket = null; }\n                if (elements.gameplayScreen) elements.gameplayScreen.classList.add(\'hidden\');\n                if (elements.ownerWaitingActions) elements.ownerWaitingActions.classList.add(\'hidden\');\n                syncLobbyData();\n                return; \n            }'
)

# 3. Remove original openGameplayScreen block
code = re.sub(
    r"elements\.createRoomModal\.classList\.add\('hidden'\);\n\s*fetchUserProfile\(\);\n\s*if \(currentBetCurrency === 'ton'\) \{\n\s*setTimeout\(updateTonBalanceDisplay, 3000\);\n\s*\}\n\s*.*?\n\s*openGameplayScreen\(roomId, true, bet\);",
    "fetchUserProfile();\n        if (currentBetCurrency === 'ton') {\n            setTimeout(updateTonBalanceDisplay, 3000);\n        }",
    code
)

with open('app.js', 'w', encoding='utf-8') as f:
    f.write(code)
print('Patched')
