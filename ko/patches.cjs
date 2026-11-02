// Changes to structs-webapp's sources that are not translation, as
// [upstream text, replacement] pairs per upstream file.
//
// structs-webapp is served by its guild, so it finds GRASS and the chain on
// the host that served the page. This client may be served from anywhere,
// so both can be set at build time (webpack.config.js); left unset, the
// upstream behaviour stands.
module.exports = {
  'js/index.js': [
    ['`ws://${window.location.hostname}:1443`', '(__KO_GRASS_URL__ || `ws://${window.location.hostname}:1443`)'],
  ],
  // Display text of struct types arrives in English; type and category stay
  // as they are, since webapp's code compares them.
  'js/factories/StructTypeFactory.js': [
    ['    return structType;', `    __ko.fields(structType, [
      'class', 'class_abbreviation', 'unit_description',
      'primary_weapon_label', 'primary_weapon_description', 'primary_weapon_class',
      'secondary_weapon_label', 'secondary_weapon_description', 'secondary_weapon_class',
      'drive_label', 'drive_description', 'passive_weaponry_label', 'passive_weaponry_description',
      'unit_defenses_label', 'unit_defenses_description', 'ore_reserve_defenses_label',
      'ore_reserve_defenses_description', 'planetary_defenses_label', 'planetary_defenses_description',
    ]);
    return structType;`],
  ],
  'js/managers/SigningClientManager.js': [
    [': `ws://${window.location.hostname}:26657`)', ': (__KO_CHAIN_WS__ || `ws://${window.location.hostname}:26657`))'],
  ],
};
