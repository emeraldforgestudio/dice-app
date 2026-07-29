import re

with open('app.js', 'r', encoding='utf-8') as f:
    code = f.read()

# Splitting by "elements.btnCreateRoom.onclick = () => {"
parts = code.split("elements.btnCreateRoom.onclick = () => {")

if len(parts) == 2:
    prefix = parts[0]
    rest = parts[1]
    
    # Within rest, replace until updateRoomLimitDisplay(); };
    regex_pattern = r"^\s*if \(checkDevPlayer\(\)\) return;\s*elements\.createRoomModal\.classList\.remove\('hidden'\);.*?updateRoomLimitDisplay\(\);\s*\};"

    replacement = """    if (checkDevPlayer()) return;
    elements.createRoomModal.classList.remove('hidden');
    
    if (userTonAddress) {
        selectBetCurrency('ton');
    } else {
        selectBetCurrency('coins');
    }
    
    updateRoomLimitDisplay();
};"""
    
    newRest = re.sub(regex_pattern, replacement, rest, flags=re.DOTALL | re.MULTILINE)
    
    if newRest != rest:
        with open('app.js', 'w', encoding='utf-8') as f:
            f.write(prefix + "elements.btnCreateRoom.onclick = () => {\n" + newRest)
        print("Patched app.js successfully")
    else:
        print("Failed to patch - regex not matched in rest")
else:
    print("Failed to patch - onclick function not found")
