from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('game', '0002_alter_gameplayer_options_gameplayer_current_screen_and_more'),  # твоя предыдущая
    ]

    operations = [
        # Колонки уже есть в БД — только обновляем состояние
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name='gameplayer',
                    name='work_end_time',
                    field=models.CharField(max_length=50, null=True, blank=True),
                ),
                migrations.AddField(
                    model_name='gameplayer',
                    name='work_reward',
                    field=models.IntegerField(default=0),
                ),
                migrations.AddField(
                    model_name='gameplayer',
                    name='work_name',
                    field=models.CharField(max_length=100, null=True, blank=True),
                ),
            ],
            database_operations=[],  # ← не выполнять SQL
        ),
    ]