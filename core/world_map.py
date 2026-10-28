from core.database import db
from core.player import player


class WorldMap:
    def __init__(self):
        self.size = db.get_map_size()
        self.player_pos = [13, 13]
        self.city_selected = False
        self.choosing_city = False

    def start_city_selection(self):
        self.choosing_city = True

    def select_city(self, x, y):
        cell = self.get_cell(x, y)
        if cell and cell.get('settlement_type') == 'city':
            self.player_pos = [x, y]
            self.choosing_city = False
            self.city_selected = True
            return True
        return False

    def get_cell(self, x, y):
        cell = db.get_map_cell(x, y)
        if cell:
            cell['x'] = x
            cell['y'] = y
            cell['biome_data'] = {
                "name": cell.get('biome_name', '?'),
                "color": [cell.get('color_r', 0.5), cell.get('color_g', 0.5),
                          cell.get('color_b', 0.5), cell.get('color_a', 1.0)],
                "movement_cost": cell.get('movement_cost', 1),
                "description": cell.get('biome_desc', '')
            }
            cell['passable'] = bool(cell.get('passable', 1))
            if cell.get('settlement_id'):
                cell['settlement'] = db.get_settlement(cell['settlement_id'])
            else:
                cell['settlement'] = None
            return cell
        return None

    def move_player(self, dx, dy):
        new_x = self.player_pos[0] + dx
        new_y = self.player_pos[1] + dy
        if 0 <= new_x < self.size and 0 <= new_y < self.size:
            cell = self.get_cell(new_x, new_y)
            if cell:
                biome_id = cell.get('biome_id', '')
                if not cell.get('passable', True):
                    if biome_id == 'sea' and not player.has_item('boat'):
                        return None
                    if biome_id == 'ocean' and not player.has_item('ship'):
                        return None
                    return None
                self.player_pos = [new_x, new_y]
                return cell
        return None

    def get_random_event(self):
        cell = self.get_cell(*self.player_pos)
        if cell and cell.get('biome_id'):
            return db.get_random_event(cell['biome_id'])
        return None

    def get_surrounding(self, radius=2):
        px, py = self.player_pos
        cells = []
        for x in range(px - radius, px + radius + 1):
            row = []
            for y in range(py - radius, py + radius + 1):
                row.append(self.get_cell(x, y))
            cells.append(row)
        return cells

    def reset(self):
        self.player_pos = [13, 13]
        self.city_selected = False
        self.choosing_city = False


world_map = WorldMap()