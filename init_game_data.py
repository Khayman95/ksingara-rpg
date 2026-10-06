import sqlite3
import os

# Подключаемся к базе
db_path = os.path.join('data', 'game.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Читаем и выполняем weapon_skills.sql
print("📦 Загружаю навыки оружия...")
with open('data/weapon_skills.sql', 'r', encoding='utf-8') as f:
    sql = f.read()
    cursor.executescript(sql)
    conn.commit()
print("✅ Навыки оружия загружены!")

# Читаем и выполняем element_spells.sql
print("📦 Загружаю заклинания стихий...")
with open('data/element_spells.sql', 'r', encoding='utf-8') as f:
    sql = f.read()
    cursor.executescript(sql)
    conn.commit()
print("✅ Заклинания стихий загружены!")

# Проверка
cursor.execute("SELECT COUNT(*) FROM weapons")
print(f"⚔️ Видов оружия: {cursor.fetchone()[0]}")

cursor.execute("SELECT COUNT(*) FROM weapon_skills")
print(f"🗡️ Навыков оружия: {cursor.fetchone()[0]}")

cursor.execute("SELECT COUNT(*) FROM weapon_skill_paths")
print(f"🔀 Путей развития оружия: {cursor.fetchone()[0]}")

cursor.execute("SELECT COUNT(*) FROM element_spells")
print(f"✨ Заклинаний: {cursor.fetchone()[0]}")

cursor.execute("SELECT COUNT(*) FROM spell_paths")
print(f"🔀 Путей заклинаний: {cursor.fetchone()[0]}")

conn.close()
print("\n🎉 Готово!")