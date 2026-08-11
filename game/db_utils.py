import sqlite3
import os
from django.conf import settings

def get_db_connection():
    """Подключается к game.db"""
    db_path = os.path.join(settings.BASE_DIR, 'data', 'game.db')
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn