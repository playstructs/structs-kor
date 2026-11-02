// Changes to structs-webapp's sources that are not translation, as
// [upstream text, replacement] pairs per upstream file.
//
// structs-webapp is served by its guild and reaches the guild API at /api,
// with a session cookie, and GRASS and the chain node on the same host. This
// page hosts none of them: these patches send webapp to the guild that
// ko/runtime/guild.js chose, with a bearer token instead of the cookie.
module.exports = {
  'js/index.js': [
    // Nothing below may run before the guild, and so its services, is known.
    // The tutorial is a simulation and needs no guild.
    ['const tutorialMode = TutorialMode.isActive();', 'if (!TutorialMode.isActive()) await __ko.guild.ready;\nconst tutorialMode = TutorialMode.isActive();'],
    ['global.guildAPI = guildAPI;', 'global.guildAPI = guildAPI;\n__ko.guild.onSwitch(async () => { gameState.thisGuild = await guildAPI.getThisGuild(); });'],
    ['`ws://${window.location.hostname}:1443`', '(__ko.guild.grass || `ws://${window.location.hostname}:1443`)'],
  ],
  'js/managers/SigningClientManager.js': [
    [': `ws://${window.location.hostname}:26657`)', ': (__ko.guild.chainWs || `ws://${window.location.hostname}:26657`))'],
  ],
  'js/api/GuildAPI.js': [
    ["this.apiUrl = '/api';", "Object.defineProperty(this, 'apiUrl', {get: () => __ko.guild.api, enumerable: true});"],
    // /auth/token takes the same signed login as /auth/login and answers with a bearer token.
    [
      'const jsonResponse = await this.ajax.post(`${this.apiUrl}/auth/login`, loginRequestDTO, {...options, reauthenticate: false});',
      'const jsonResponse = await this.ajax.post(`${this.apiUrl}/auth/token`, loginRequestDTO, {...options, reauthenticate: false});\n'
      + '    __ko.guild.setToken(jsonResponse?.success ? jsonResponse.data?.access_token : null);',
    ],
    [
      'const jsonResponse = await this.ajax.post(`${this.apiUrl}/auth/logout`, {}, options);',
      'const jsonResponse = await this.ajax.post(`${this.apiUrl}/auth/logout`, {}, options);\n    __ko.guild.setToken(null);',
    ],
    // A code made on another device is kept by that player's guild.
    [
      'const jsonResponse = await this.ajax.get(`${this.apiUrl}/auth/activation-code/${activationCode}`);',
      'const jsonResponse = await __ko.guild.findOnGuilds(\n'
      + '      () => this.ajax.get(`${this.apiUrl}/auth/activation-code/${activationCode}`),\n'
      + '      answer => answer?.success === true && answer.data != null\n'
      + '    );',
    ],
  ],
  'js/framework/JsonAjaxer.js': [
    ["headers: {\n        'Content-Type': 'application/json'\n      },", "headers: {\n        'Content-Type': 'application/json',\n        ...__ko.guild.headers()\n      },"],
  ],
  'js/managers/AuthManager.js': [
    // A recovery key names a player, who plays through their own guild.
    [
      'const primaryAddress = this.gameState.signingAccount.address;\n    const guildId = this.gameState.thisGuild.id;',
      'const primaryAddress = this.gameState.signingAccount.address;\n    await __ko.guild.followAddress(primaryAddress);\n    const guildId = this.gameState.thisGuild.id;',
    ],
  ],
  'js/telemetry/OnboardingTelemetry.js': [
    ['fetch(ENDPOINT, {', 'fetch(`${__ko.guild.api}/onboarding/events`, {'],
    ['navigator.sendBeacon(ENDPOINT, body)', 'navigator.sendBeacon(`${__ko.guild.api}/onboarding/events`, body)'],
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
};
