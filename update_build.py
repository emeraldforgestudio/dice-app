import re
import subprocess
import os

def main():
    # Находимся в корне репозитория dice-app
    # Получаем количество коммитов
    try:
        count = int(subprocess.check_output(["git", "rev-list", "--count", "HEAD"], stderr=subprocess.DEVNULL).strip()) + 1
    except Exception:
        count = 1

    # Получаем текущий short SHA
    try:
        sha = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], stderr=subprocess.DEVNULL).strip().decode("utf-8")
    except Exception:
        sha = "dev"

    build_str = f"Build: #{count} ({sha})"
    
    html_path = "index.html"
    if not os.path.exists(html_path):
        print(f"Error: {html_path} not found")
        return

    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    # Заменяем старый номер сборки на новый
    # Ищет паттерн | Build: [любые символы кроме <]
    pattern = r"\|\s*Build:\s*[^<]+"
    replacement = f"| {build_str}"
    
    if not re.search(pattern, html):
        print("Warning: Build string placeholder not found in index.html")
        return

    new_html = re.sub(pattern, replacement, html)

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(new_html)

    print(f"Successfully updated build number in index.html to: {build_str}")

if __name__ == "__main__":
    main()
