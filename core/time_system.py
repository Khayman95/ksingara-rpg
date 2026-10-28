import time
from datetime import datetime


class KsingaraCalendar:
    """Календарь Ксингара"""

    # Основные константы
    SECONDS_PER_MINUTE = 100
    MINUTES_PER_HOUR = 100
    SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR  # 10,000
    HOURS_PER_DAY = 20
    SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY  # 200,000
    DAYS_PER_WEEK = 10
    WEEKS_PER_MONTH = 4
    DAYS_PER_MONTH = DAYS_PER_WEEK * WEEKS_PER_MONTH  # 40
    MONTHS_PER_YEAR = 9
    DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR  # 360
    YEARS_PER_CYCLE = 4
    DAYS_PER_CYCLE = DAYS_PER_YEAR * YEARS_PER_CYCLE + 1  # 1441

    # 10 дней недели
    DAY_NAMES = [
        "Пирос", "Гидрос", "Аэрос", "Террос", "Ноктис",
        "Фульгрис", "Гелиос", "Лумис", "Витрис", "Анима"
    ]

    DAY_DESCRIPTIONS = {
        "Пирос": "День энергии и начинаний",
        "Гидрос": "День интуиции и эмоций",
        "Аэрос": "День общения и путешествий",
        "Террос": "День труда",
        "Ноктис": "День отдыха и размышлений",
        "Фульгрис": "День внезапных перемен",
        "Гелиос": "День силы и магии",
        "Лумис": "День тайн и снов",
        "Витрис": "День ясности и анализа",
        "Анима": "День души и семьи"
    }

    # 9 месяцев
    MONTH_NAMES = [
        "Игнис", "Акванис", "Вентрис", "Умбрис", "Астралис",
        "Гласис", "Темпестис", "Кристаллис", "Фениксис"
    ]

    MONTH_DESCRIPTIONS = {
        "Игнис": "Месяц жары и активности",
        "Акванис": "Месяц дождей и очищения",
        "Вентрис": "Месяц бурь и перемен",
        "Умбрис": "Месяц туманов и тайн",
        "Астралис": "Месяц астральной энергии",
        "Гласис": "Месяц заморозков и покоя",
        "Темпестис": "Месяц гроз и откровений",
        "Кристаллис": "Месяц инея и ясности",
        "Фениксис": "Месяц возрождения"
    }

    @classmethod
    def seconds_to_time(cls, total_seconds):
        """Конвертирует секунды в компоненты времени"""
        seconds_in_day = total_seconds % cls.SECONDS_PER_DAY
        hour = int(seconds_in_day // cls.SECONDS_PER_HOUR)
        minute = int((seconds_in_day % cls.SECONDS_PER_HOUR) // cls.SECONDS_PER_MINUTE)
        second = int(seconds_in_day % cls.SECONDS_PER_MINUTE)

        total_days = int(total_seconds // cls.SECONDS_PER_DAY)
        year, month, day_in_month, day_name, day_of_week, is_timeless = cls.days_to_date(total_days)

        # 0-10 = день, 10-20 = ночь
        is_day = hour < 10

        return {
            "hour": hour,
            "minute": minute,
            "second": second,
            "time_string": f"{hour:02d}:{minute:02d}:{second:02d}",
            "day_name": day_name,
            "day_description": cls.DAY_DESCRIPTIONS.get(day_name, ""),
            "day_of_week": day_of_week + 1,
            "day_in_month": day_in_month,
            "month": month + 1,
            "month_name": cls.MONTH_NAMES[month] if not is_timeless else "—",
            "month_description": cls.MONTH_DESCRIPTIONS.get(cls.MONTH_NAMES[month],
                                                            "") if not is_timeless else "День Безвременья",
            "year": year,
            "is_day": is_day,
            "is_night": not is_day,
            "is_timeless": is_timeless,
            "phase": "☀️ День" if is_day else "🌙 Ночь",
        }

    @classmethod
    def days_to_date(cls, total_days):
        """Конвертирует дни в (год, месяц, день, ...)"""
        cycles = total_days // cls.DAYS_PER_CYCLE
        days_in_cycle = total_days % cls.DAYS_PER_CYCLE

        year_in_cycle = days_in_cycle // cls.DAYS_PER_YEAR
        if year_in_cycle > 3:
            year_in_cycle = 3

        days_in_year = days_in_cycle - (year_in_cycle * cls.DAYS_PER_YEAR)
        year = cycles * cls.YEARS_PER_CYCLE + year_in_cycle + 1

        # День Безвременья — в 4-м году цикла после 360 дней
        is_timeless = (year_in_cycle == 3) and (days_in_year >= cls.DAYS_PER_YEAR)

        if is_timeless:
            return year, 8, 0, "День Безвременья", 0, True

        month = days_in_year // cls.DAYS_PER_MONTH
        day_in_month = days_in_year % cls.DAYS_PER_MONTH
        day_of_week = day_in_month % cls.DAYS_PER_WEEK
        day_name = cls.DAY_NAMES[day_of_week]

        return year, month, day_in_month + 1, day_name, day_of_week, False


class GameClock:
    """Игровые часы Ксингара — время идёт в реальном времени с масштабом"""

    def __init__(self):
        # 1 реальная секунда = 1 игровых секунд (по умолчанию)
        self.time_scale = 1
        # Стартовое время: год 1, месяц Игнис, 1-й день Пирос, 06:00 утра
        self.start_seconds = 6 * KsingaraCalendar.SECONDS_PER_HOUR
        self.real_epoch = time.time()  # Момент старта сервера

        # Если нужно сохранять — это значение будет переопределено из БД
        self.game_start_seconds = self.start_seconds

    def get_current_seconds(self):
        """Вычисляет текущее игровое время динамически"""
        real_elapsed = time.time() - self.real_epoch
        return self.game_start_seconds + (real_elapsed * self.time_scale)

    @property
    def current(self):
        """Текущее время в читаемом виде"""
        return KsingaraCalendar.seconds_to_time(self.get_current_seconds())

    @property
    def current_seconds(self):
        return self.get_current_seconds()

    def skip_time(self, hours=0, minutes=0, seconds=0):
        """Пропустить время (для DevMode)"""
        skip = (hours * KsingaraCalendar.SECONDS_PER_HOUR
                + minutes * KsingaraCalendar.SECONDS_PER_MINUTE
                + seconds)
        self.game_start_seconds += skip
        self.real_epoch = time.time()
        return self.current

    def set_time(self, hours=6, minutes=0):
        """Установить конкретное время дня (для тестов)"""
        current = self.get_current_seconds()
        total_days = int(current // KsingaraCalendar.SECONDS_PER_DAY)
        new_seconds = (total_days * KsingaraCalendar.SECONDS_PER_DAY
                       + hours * KsingaraCalendar.SECONDS_PER_HOUR
                       + minutes * KsingaraCalendar.SECONDS_PER_MINUTE)
        self.game_start_seconds = new_seconds
        self.real_epoch = time.time()
        return self.current

    def set_scale(self, scale):
        """Изменить скорость времени (1x - 100x)"""
        self.game_start_seconds = self.get_current_seconds()
        self.real_epoch = time.time()
        self.time_scale = max(1, min(100, scale))
        return self.time_scale

    def is_day(self):
        """Сейчас день?"""
        return self.current['is_day']

    def is_night(self):
        """Сейчас ночь?"""
        return self.current['is_night']

    def get_today_modifier(self):
        """Модификатор от текущего дня недели"""
        day = self.current['day_name']
        modifiers = {
            "Пирос": {"new_start_bonus": True, "description": "+10% к опыту за новое"},
            "Гидрос": {"intuition_bonus": True, "description": "+5% к уклонению"},
            "Аэрос": {"travel_bonus": True, "description": "Быстрее перемещение"},
            "Террос": {"work_bonus": 1.2, "description": "+20% к заработку"},
            "Ноктис": {"rest_bonus": True, "description": "Отдых восстанавливает больше"},
            "Фульгрис": {"random_events": True, "description": "Больше случайных событий"},
            "Гелиос": {"magic_bonus": 1.2, "description": "+20% к магии"},
            "Лумис": {"divination_bonus": True, "description": "Гадания точнее"},
            "Витрис": {"analysis_bonus": True, "description": "Больше информации в кодексе"},
            "Анима": {"family_bonus": True, "description": "Скидки в поселениях"},
        }
        return modifiers.get(day, {})


# Глобальные часы
game_clock = GameClock()