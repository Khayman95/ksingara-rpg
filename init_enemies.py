import sqlite3
import os

db_path = os.path.join('data', 'game.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("📦 Загружаю врагов...")

# Читаем SQL-файл с врагами
sql_file = os.path.join('data', 'enemies.sql')

if not os.path.exists(sql_file):
    print(f"❌ Файл {sql_file} не найден!")
    print("Создай его сначала (см. предыдущее сообщение)")
    exit(1)

with open(sql_file, 'r', encoding='utf-8') as f:
    sql = f.read()
    cursor.executescript(sql)
    conn.commit()

# Проверка
cursor.execute("SELECT COUNT(*) FROM enemies")
enemies_count = cursor.fetchone()[0]
print(f"✅ Врагов загружено: {enemies_count}")

cursor.execute("SELECT COUNT(*) FROM element_resistances")
resist_count = cursor.fetchone()[0]
print(f"✅ Сопротивлений загружено: {resist_count}")

conn.close()
print("🎉 Готово!")