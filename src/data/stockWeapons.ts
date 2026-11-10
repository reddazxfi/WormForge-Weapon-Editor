export interface StockWeaponInfo {
  id: string;
  name: string;
  family: 'missile' | 'gun' | 'strike' | 'mine' | 'special' | 'arrow' | 'spray';
  icon: string;
  row: string;
  column: number;
  description: string;
}

export const STOCK_WEAPONS: StockWeaponInfo[] = [
  // F1
  { id: 'bazooka', name: 'Bazooka', family: 'missile', icon: 'bazooka', row: 'F1', column: 1, description: 'Power-charged wind-sensitive rocket' },
  { id: 'homing_missile', name: 'Homing Missile', family: 'missile', icon: 'hmissile', row: 'F1', column: 2, description: 'Locks onto cursor target after initial launch' },
  { id: 'mortar', name: 'Mortar', family: 'missile', icon: 'mortar', row: 'F1', column: 3, description: 'High arc ballistic bomb bursting into cluster bits' },
  { id: 'homing_pigeon', name: 'Homing Pigeon', family: 'missile', icon: 'pigeon', row: 'F1', column: 4, description: 'Avoids terrain while seeking target' },
  { id: 'sheep_launcher', name: 'Sheep Launcher', family: 'missile', icon: 'launch', row: 'F1', column: 5, description: 'Fires an airborne sheep projectile' },

  // F2
  { id: 'grenade', name: 'Grenade', family: 'missile', icon: 'grenade', row: 'F2', column: 1, description: 'Manual 1-5s fuse grenade with bounce physics' },
  { id: 'cluster_bomb', name: 'Cluster Bomb', family: 'missile', icon: 'cluster', row: 'F2', column: 2, description: 'Timed fuse splitting into 5 bouncing bits' },
  { id: 'banana_bomb', name: 'Banana Bomb', family: 'missile', icon: 'banana', row: 'F2', column: 3, description: 'High bounce explosive bursting into mega-power bananas' },
  { id: 'battle_axe', name: 'Battle Axe', family: 'special', icon: 'axe', row: 'F2', column: 4, description: 'Melee weapon halving target worm health' },
  { id: 'earthquake', name: 'Earthquake', family: 'special', icon: 'quake', row: 'F2', column: 5, description: 'Global tremor shifting worms and objects' },

  // F3
  { id: 'shotgun', name: 'Shotgun', family: 'gun', icon: 'shotgun', row: 'F3', column: 1, description: 'Double-shot spread firearm' },
  { id: 'handgun', name: 'Handgun', family: 'gun', icon: 'handgun', row: 'F3', column: 2, description: '6-round rapid pistol' },
  { id: 'uzi', name: 'Uzi', family: 'gun', icon: 'uzi', row: 'F3', column: 3, description: 'Automatic submachine gun spray' },
  { id: 'minigun', name: 'Minigun', family: 'gun', icon: 'minigun', row: 'F3', column: 4, description: 'High-velocity heavy bullet stream' },
  { id: 'longbow', name: 'Longbow', family: 'arrow', icon: 'longbow', row: 'F3', column: 5, description: 'Twin arrows with pinning physics' },

  // F4
  { id: 'fire_punch', name: 'Fire Punch', family: 'special', icon: 'firepnch', row: 'F4', column: 1, description: 'Upward martial punch dealing 30 damage' },
  { id: 'dragon_ball', name: 'Dragon Ball', family: 'special', icon: 'dragball', row: 'F4', column: 2, description: 'Energy blast pushing enemies away' },
  { id: 'kamikaze', name: 'Kamikaze', family: 'special', icon: 'kamikaze', row: 'F4', column: 3, description: 'Sacrificial rocket drill flight' },
  { id: 'suicide_bomber', name: 'Suicide Bomber', family: 'special', icon: 'suicide', row: 'F4', column: 4, description: 'Self-detonation with poison cloud' },
  { id: 'prod', name: 'Prod', family: 'special', icon: 'prod', row: 'F4', column: 5, description: 'Gentle nudge into water or mines' },

  // F5
  { id: 'dynamite', name: 'Dynamite', family: 'missile', icon: 'dynamite', row: 'F5', column: 1, description: 'Dropped 5s fuse heavy 75-damage explosive' },
  { id: 'mine', name: 'Mine', family: 'mine', icon: 'mine', row: 'F5', column: 2, description: 'Proximity detection mine with random 0-3s fuse' },
  { id: 'sheep', name: 'Sheep', family: 'missile', icon: 'sheep', row: 'F5', column: 3, description: 'Walking animal jumping obstacles before detonating' },
  { id: 'super_sheep', name: 'Super Sheep', family: 'missile', icon: 'sprsheep', row: 'F5', column: 4, description: 'Steerable flying superhero sheep' },
  { id: 'aqua_sheep', name: 'Aqua Sheep', family: 'missile', icon: 'aqua', row: 'F5', column: 5, description: 'Water-diving flying sheep' },
  { id: 'mole_bomb', name: 'Mole Bomb', family: 'missile', icon: 'mole', row: 'F5', column: 6, description: 'Burrowing mole digging underground before exploding' },

  // F6
  { id: 'air_strike', name: 'Air Strike', family: 'strike', icon: 'airstrke', row: 'F6', column: 1, description: 'Jet plane dropping 5 aerial missiles' },
  { id: 'napalm_strike', name: 'Napalm Strike', family: 'strike', icon: 'firestrk', row: 'F6', column: 2, description: 'Jet dropping spreading incendiary fire' },
  { id: 'mail_strike', name: 'Mail Strike', family: 'strike', icon: 'postal', row: 'F6', column: 3, description: 'Parachuting letters drifting on the wind' },
  { id: 'mine_strike', name: 'Mine Strike', family: 'strike', icon: 'minestrk', row: 'F6', column: 4, description: 'Plane dropping 5 live proximity mines' },
  { id: 'mole_squadron', name: 'Mole Squadron', family: 'strike', icon: 'molestrk', row: 'F6', column: 5, description: 'Drilling squadron cutting vertical shafts' },

  // F7
  { id: 'blow_torch', name: 'Blow Torch', family: 'special', icon: 'blwtorch', row: 'F7', column: 1, description: 'Horizontal/angled tunnel cutting tool' },
  { id: 'pneumatic_drill', name: 'Pneumatic Drill', family: 'special', icon: 'drill', row: 'F7', column: 2, description: 'Vertical ground drill' },
  { id: 'girder', name: 'Girder', family: 'special', icon: 'girder', row: 'F7', column: 3, description: 'Bridge placement obstacle' },
  { id: 'baseball_bat', name: 'Baseball Bat', family: 'special', icon: 'baseball', row: 'F7', column: 4, description: 'Heavy slugger launching enemy worms' },
  { id: 'girder_pack', name: 'Girder Pack', family: 'special', icon: 'girders', row: 'F7', column: 5, description: 'Set of 5 steel girders' },

  // F8
  { id: 'ninja_rope', name: 'Ninja Rope', family: 'special', icon: 'rope', row: 'F8', column: 1, description: 'Flexible swinging traversal rope' },
  { id: 'bungee', name: 'Bungee', family: 'special', icon: 'bungee', row: 'F8', column: 2, description: 'Elastic cliff drop cord' },
  { id: 'parachute', name: 'Parachute', family: 'special', icon: 'parachut', row: 'F8', column: 3, description: 'Wind-guided safe descent umbrella' },
  { id: 'teleport', name: 'Teleport', family: 'special', icon: 'teleport', row: 'F8', column: 4, description: 'Instant beam to any cursor position' },
  { id: 'scales_of_justice', name: 'Scales of Justice', family: 'special', icon: 'scales', row: 'F8', column: 5, description: 'Redistributes team health evenly' },

  // F9
  { id: 'super_banana', name: 'Super Banana Bomb', family: 'missile', icon: 'sbanana', row: 'F9', column: 1, description: 'Super bouncy banana detonated on Space' },
  { id: 'holy_grenade', name: 'Holy Hand Grenade', family: 'missile', icon: 'hgrenade', row: 'F9', column: 2, description: 'Halts, chants HALLELUJAH, and delivers power 100 blast' },
  { id: 'flame_thrower', name: 'Flame Thrower', family: 'spray', icon: 'thrower', row: 'F9', column: 3, description: 'Continuous napalm fire jet' },
  { id: 'salvation_army', name: 'Salvation Army', family: 'missile', icon: 'tamborin', row: 'F9', column: 4, description: 'Singing tambourine dropping exploding instruments' },
  { id: 'mb_bomb', name: 'MB Bomb', family: 'missile', icon: 'mbbomb', row: 'F9', column: 5, description: 'Floating explosive cloud pushed by wind' },

  // F10
  { id: 'petrol_bomb', name: 'Petrol Bomb', family: 'missile', icon: 'petrolbm', row: 'F10', column: 1, description: 'Spatter bottle covering terrain with fire' },
  { id: 'skunk', name: 'Skunk', family: 'missile', icon: 'skunk', row: 'F10', column: 2, description: 'Roaming animal spraying poison clouds' },
  { id: 'ming_vase', name: 'Ming Vase', family: 'missile', icon: 'mingvase', row: 'F10', column: 3, description: 'Antique ceramic vase bursting into shrapnel' },
  { id: 'sheep_strike', name: 'Sheep Strike', family: 'strike', icon: 'shpstrke', row: 'F10', column: 4, description: 'Plane carpet-bombing exploding sheep' },
  { id: 'carpet_bomb', name: 'Carpet Bomb', family: 'strike', icon: 'carpet', row: 'F10', column: 5, description: '5 bouncy carpets carpet-bombing terrain' },

  // F11
  { id: 'mad_cow', name: 'Mad Cow', family: 'missile', icon: 'cow', row: 'F11', column: 1, description: 'Herd of exploding cows charging forward' },
  { id: 'old_woman', name: 'Old Woman', family: 'missile', icon: 'oldwoman', row: 'F11', column: 2, description: 'Deaf old lady wandering and grumbling' },
  { id: 'donkey', name: 'Concrete Donkey', family: 'missile', icon: 'donkey', row: 'F11', column: 3, description: 'Massive heavy statue bouncing through terrain to water' },
  { id: 'nuclear_test', name: 'Nuclear Bomb', family: 'special', icon: 'nuke', row: 'F11', column: 4, description: 'Floods map with radiation and poison' },
  { id: 'armageddon', name: 'Armageddon', family: 'special', icon: 'armagedn', row: 'F11', column: 5, description: 'Meteor shower crashing across the map' },

  // F12
  { id: 'skip_go', name: 'Skip Go', family: 'special', icon: 'skipgo', row: 'F12', column: 1, description: 'Passes current worm turn' },
  { id: 'surrender', name: 'Surrender', family: 'special', icon: 'surender', row: 'F12', column: 2, description: 'Forfeits the match' },
  { id: 'select_worm', name: 'Select Worm', family: 'special', icon: 'select', row: 'F12', column: 3, description: 'Cycle active team worm' },
  { id: 'freeze', name: 'Freeze', family: 'special', icon: 'freeze', row: 'F12', column: 4, description: 'Encloses worms in invulnerable ice for 1 turn' },
  { id: 'magic_bullet', name: 'Magic Bullet', family: 'missile', icon: 'bullet', row: 'F12', column: 5, description: 'Ultra-fast dodger bullet' },

  // Utilities
  { id: 'jet_pack', name: 'Jet Pack', family: 'special', icon: 'jetpack', row: 'utility', column: 1, description: 'Personal rocket backpack' },
  { id: 'low_gravity', name: 'Low Gravity', family: 'special', icon: 'gravity', row: 'utility', column: 2, description: 'Halves world gravity for the turn' },
  { id: 'fast_walk', name: 'Fast Walk', family: 'special', icon: 'speed', row: 'utility', column: 3, description: 'Doubles walking speed' },
  { id: 'laser_sight', name: 'Laser Sight', family: 'special', icon: 'laser', row: 'utility', column: 4, description: 'Weapon aim trajectory laser' },
  { id: 'invisibility', name: 'Invisibility', family: 'special', icon: 'invisibl', row: 'utility', column: 5, description: 'Hides team worms from enemies' },
  { id: 'damage_x2', name: 'Damage x2', family: 'special', icon: 'damagex2', row: 'utility', column: 6, description: 'Doubles all weapon explosion damage' },
  { id: 'crate_spy', name: 'Crate Spy', family: 'special', icon: 'cratespy', row: 'utility', column: 7, description: 'Reveals crate contents on map' },
  { id: 'double_turn_time', name: 'Double Turn Time', family: 'special', icon: 'clone', row: 'utility', column: 8, description: 'Doubles turn seconds' },
  { id: 'crate_shower', name: 'Crate Shower', family: 'special', icon: 'canister', row: 'utility', column: 9, description: 'Spawns multiple weapon/utility crates' },
];

export const STOCK_BY_ID = new Map(STOCK_WEAPONS.map((w) => [w.id, w]));

export function getStockPanelPosition(slotId: string): { row: string; column: number } {
  const stock = STOCK_BY_ID.get(slotId);
  if (stock) return { row: stock.row, column: stock.column };
  return { row: 'F1', column: 1 };
}
