"""Тест системы времени"""
from core.time_system import KsingaraCalendar, game_clock

print("=" * 60)
print("🕐 ТЕСТ СИСТЕМЫ ВРЕМЕНИ КСИНГАРА")
print("=" * 60)

# Текущее время
print("\n📅 Текущее время:")
t = game_clock.current
print(f"  {t['phase']} {t['time_string']}")
print(f"  День: {t['day_name']} ({t['day_description']})")
print(f"  Месяц: {t['month_name']} — день {t['day_in_month']}")
print(f"  Год: {t['year']}")

# Проверка констант
print("\n📊 Константы календаря:")
print(f"  Секунд в минуте: {KsingaraCalendar.SECONDS_PER_MINUTE}")
print(f"  Минут в часе: {KsingaraCalendar.MINUTES_PER_HOUR}")
print(f"  Часов в сутках: {KsingaraCalendar.HOURS_PER_DAY}")
print(f"  Дней в неделе: {KsingaraCalendar.DAYS_PER_WEEK}")
print(f"  Дней в месяце: {KsingaraCalendar.DAYS_PER_MONTH}")
print(f"  Месяцев в году: {KsingaraCalendar.MONTHS_PER_YEAR}")
print(f"  Дней в году: {KsingaraCalendar.DAYS_PER_YEAR}")
print(f"  Дней в цикле (4 года): {KsingaraCalendar.DAYS_PER_CYCLE}")

# Проверка дней недели
print("\n📆 Дни недели:")
for i, day in enumerate(KsingaraCalendar.DAY_NAMES, 1):
    print(f"  {i}. {day}: {KsingaraCalendar.DAY_DESCRIPTIONS[day]}")

# Проверка месяцев
print("\n🗓️ Месяцы:")
for i, month in enumerate(KsingaraCalendar.MONTH_NAMES, 1):
    print(f"  {i}. {month}: {KsingaraCalendar.MONTH_DESCRIPTIONS[month]}")

# Пропустить год
print("\n⏩ Пропускаем 1 игровой год...")
game_clock.skip_time(hours=KsingaraCalendar.HOURS_PER_DAY * KsingaraCalendar.DAYS_PER_YEAR)
t = game_clock.current
print(f"  {t['year']} г., {t['month_name']} {t['day_in_month']}, {t['day_name']}")

# Пропустить 4 года (проверка Дня Безвременья)
print("\n⏩ Пропускаем ещё 3 года...")
game_clock.skip_time(hours=KsingaraCalendar.HOURS_PER_DAY * KsingaraCalendar.DAYS_PER_YEAR * 3)
t = game_clock.current
print(f"  {t['year']} г., {t['month_name']} {t['day_in_month']}, {t['day_name']}")

# Пропустить до Дня Безвременья
print("\n⏩ Пропускаем в День Безвременья...")
game_clock.skip_time(hours=KsingaraCalendar.HOURS_PER_DAY * 40)  # после 9 месяцев
t = game_clock.current
print(f"  {t['year']} г., is_timeless={t['is_timeless']}")
if t['is_timeless']:
    print(f"  ⚠️ ДЕНЬ БЕЗВРЕМЕНЬЯ!")
else:
    print(f"  {t['month_name']} {t['day_in_month']}, {t['day_name']}")

print("\n" + "=" * 60)