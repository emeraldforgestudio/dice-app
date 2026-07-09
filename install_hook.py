import os
import stat

def main():
    # Проверяем, что находимся в корне репозитория и папка .git существует
    hook_dir = os.path.join(".git", "hooks")
    if not os.path.exists(hook_dir):
        print("Error: .git/hooks directory not found. Please run this script in the root of dice-app.")
        return

    hook_path = os.path.join(hook_dir, "pre-commit")
    
    # Содержимое хука. Используем \n в качестве переноса строк
    hook_content = "#!/bin/sh\npython update_build.py\ngit add index.html\n"
    
    with open(hook_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(hook_content)
        
    # Делаем файл исполняемым (актуально для macOS, Linux и Git Bash в Windows)
    try:
        st = os.stat(hook_path)
        os.chmod(hook_path, st.st_mode | stat.S_IEXEC)
    except Exception as e:
        print(f"Warning setting executable permissions: {e}")
        
    print("Git pre-commit hook successfully installed!")
    print("From now on, the build number in index.html will be automatically updated and staged on every 'git commit'!")

if __name__ == "__main__":
    main()
