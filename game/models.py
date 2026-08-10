from django.db import models


class Biome(models.Model):
    id = models.CharField(max_length=50, primary_key=True)
    name = models.CharField(max_length=100)
    icon = models.CharField(max_length=200, blank=True, null=True)
    color_r = models.FloatField(default=0.5)
    color_g = models.FloatField(default=0.5)
    color_b = models.FloatField(default=0.5)
    color_a = models.FloatField(default=1.0)
    description = models.TextField(blank=True, null=True)
    movement_cost = models.IntegerField(default=1)
    passable_without_boat = models.BooleanField(default=True)

    class Meta:
        managed = False  # Не создавать таблицу — используем существующую
        db_table = 'biomes'


class Settlement(models.Model):
    id = models.CharField(max_length=50, primary_key=True)
    name = models.CharField(max_length=100)
    type = models.CharField(max_length=50)
    race = models.CharField(max_length=50, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    icon = models.CharField(max_length=200, blank=True, null=True)
    services = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'settlements'


class MapCell(models.Model):
    x = models.IntegerField()
    y = models.IntegerField()
    biome = models.ForeignKey(Biome, on_delete=models.DO_NOTHING, db_column='biome_id')
    passable = models.BooleanField(default=True)
    settlement = models.ForeignKey(Settlement, on_delete=models.DO_NOTHING, null=True, blank=True,
                                   db_column='settlement_id')
    description = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'map_cells'
        unique_together = ('x', 'y')


class Mob(models.Model):
    id = models.CharField(max_length=50, primary_key=True)
    name = models.CharField(max_length=100)
    health = models.IntegerField(default=30)
    damage = models.IntegerField(default=5)
    defense = models.IntegerField(default=0)
    exp_reward = models.IntegerField(default=10)
    icon = models.CharField(max_length=200, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'mobs'


class Event(models.Model):
    id = models.CharField(max_length=50, primary_key=True)
    name = models.CharField(max_length=100)
    type = models.CharField(max_length=50)
    description = models.TextField(blank=True, null=True)
    chance = models.FloatField(default=0.3)
    message = models.TextField(blank=True, null=True)
    damage = models.IntegerField(null=True, blank=True)
    heal_percent = models.IntegerField(null=True, blank=True)
    heal_mana_percent = models.IntegerField(null=True, blank=True)
    dungeon_id = models.CharField(max_length=50, null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'events'


# Django-модель для игрока (новая, твоя)
class Player(models.Model):
    user = models.OneToOneField('auth.User', on_delete=models.CASCADE)
    name = models.CharField(max_length=20)
    gender = models.CharField(max_length=10, null=True)
    race = models.CharField(max_length=50, null=True)
    element = models.CharField(max_length=50, null=True)
    strength = models.IntegerField(default=5)
    agility = models.IntegerField(default=5)
    intelligence = models.IntegerField(default=5)
    gold = models.IntegerField(default=100)
    max_health = models.IntegerField(default=100)
    current_health = models.IntegerField(default=100)
    max_mana = models.IntegerField(default=50)
    current_mana = models.IntegerField(default=50)
    city_selected = models.BooleanField(default=False)
    player_x = models.IntegerField(default=13)
    player_y = models.IntegerField(default=13)
    active_slot = models.IntegerField(default=1)
    pity_counter = models.IntegerField(default=0)  # Для гачи

    def __str__(self):
        return self.name


# Модель персонажа (для гача-системы, потом)
class Character(models.Model):
    name = models.CharField(max_length=100)
    race = models.CharField(max_length=50)
    element = models.CharField(max_length=50)
    rarity = models.IntegerField(default=3)  # 3, 4, 5 звёзд
    base_strength = models.IntegerField(default=5)
    base_agility = models.IntegerField(default=5)
    base_intelligence = models.IntegerField(default=5)
    skill_name = models.CharField(max_length=100)
    skill_description = models.TextField()
    icon = models.CharField(max_length=200, blank=True)
    is_featured = models.BooleanField(default=False)  # В текущем баннере

    def __str__(self):
        return f"{self.name} ({self.get_rarity_display()})"

# Потом добавим Banner, GachaPull, PvPMatch...