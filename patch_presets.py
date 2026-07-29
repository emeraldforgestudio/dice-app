import re

# Patch app.js
with open('app.js', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace inputBet.value setters in selectBetCurrency
code = code.replace("inputBet.value = '0.5';", "inputBet.value = '';")
code = code.replace("inputBet.value = '500';", "inputBet.value = '';")

with open('app.js', 'w', encoding='utf-8') as f:
    f.write(code)
print("app.js patched")

# Patch index.html
with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Add 0.05 button to preset-bets-ton
old_ton_presets = '<div class="preset-bets hidden" id="preset-bets-ton">\n                    <button class="btn-preset" data-val="0.1">0.1</button>'
new_ton_presets = '<div class="preset-bets hidden" id="preset-bets-ton">\n                    <button class="btn-preset" data-val="0.05">0.05</button>\n                    <button class="btn-preset" data-val="0.1">0.1</button>'

if old_ton_presets in html:
    html = html.replace(old_ton_presets, new_ton_presets)
else:
    # Alternative format matching
    html = re.sub(
        r'(<div class="preset-bets hidden" id="preset-bets-ton">\s*)(<button class="btn-preset" data-val="0.1">)',
        r'\1<button class="btn-preset" data-val="0.05">0.05</button>\n                    \2',
        html
    )

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("index.html patched")
